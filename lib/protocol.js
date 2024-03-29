Protocol = function (manager, data, version, tryUpdate) {
	var self = this;
	self.manager = manager;
	self._id = ko.observable(data && data._id);
	self.version = version === undefined ? data && data.v.length - 1 : version;
	self.oldVersion = data && self.version != data.v.length - 1;
	self.DBData = data;
	self.data = data && data.v[self.version];

	self.needsReview = data && data.needsReview;

	self.autoUpdateFailed = false; // only meaningful if tryUpdate == true

	self.name = ko.observable(self.data && self.data.name);
	self.params = ko.observableArray(self.data ? _.map(self.data.params, function (param) {
		return new ProtocolParam(self, param);
	}) : []);
	self.steps = ko.observableArray(self.data ? _.map(self.data.steps, function (step) {
		return new ProtocolStep(self, step);
	}) : []);
	self.products = ko.observableArray(self.data ? _.map(self.data.products, function (product) {
		return new ProtocolProduct(self, product, tryUpdate);
	}) : []);
};

Protocol.prototype.addParam = function () {
	this.params.push(new ProtocolParam(this));
};

Protocol.prototype.removeParam = function (param) {
	this.params.remove(param);
};

Protocol.prototype.addStep = function () {
	this.steps.push(new ProtocolStep(this));
};

Protocol.prototype.removeStep = function (step) {
	this.steps.remove(step);
};

Protocol.prototype.addProduct = function () {
	this.products.push(new ProtocolProduct(this));
};

Protocol.prototype.removeProduct = function (product) {
	this.products.remove(product);
};

Protocol.prototype.toReference = function () {
	var id = this._id();
	return id && {
		_id: id,
		name: this.name(),
		v: this.version
	};
};

Protocol.prototype.flatten = function () {
	var flat = {
		name: this.name(),
		params: _.map(this.params(), function (param) {
			return param.flatten();
		}),
		steps: _.map(this.steps(), function (step) {
			return step.flatten();
		}),
		products: _.map(this.products(), function (product) {
			return product.flatten();
		}),
		versionMappings: null,
	};

	if (this.autoUpdateFailed) throw flat; // TODO: Not very elegant ...
	return flat;
};

ProtocolParam = function (protocol, data) {
	var self = this;
	self.types = _.map(Types.find().fetch(), function (type) {
		return protocol.manager.getType(type._id, undefined, type);
	});
	self.type = ko.observable(data ? protocol.manager.getType(data.type._id) : self.types[0]);
	self.name = ko.observable(data && data.name);
	self.multi = ko.observable(data ? data.multi : false);

	var handle;
	if (!data || data.name == data.type.name) {
		handle = self.type.subscribe(function (newValue) {
			self.name(newValue.name());
		});
	}
};

ProtocolParam.prototype.nameChanged = function () {
	if (this.handle) {
		this.handle.dispose();
		delete this.handle;
	}
};

ProtocolParam.prototype.flatten = function () {
	return {
		type: this.type().toReference(),
		name: this.name(),
		multi: this.multi(),
	};
};

ProtocolStep = function (protocol, data) {
	var self = this;
	self.protocol = protocol;
	self.desc = ko.observable(data && data.desc);
	self.inputs = ko.observableArray(data ? _.map(data.inputs, function (input) {
		return new ProtocolStepInput(protocol, input);
	}) : []);
}

ProtocolStep.prototype.addInput = function () {
	this.inputs.push(new ProtocolStepInput(this.protocol));
};

ProtocolStep.prototype.removeInput = function (input) {
	this.inputs.remove(input);
};

ProtocolStep.prototype.flatten = function () {
	return {
		desc: this.desc(),
		inputs: _.map(this.inputs(), function (input) {
			return input.flatten();
		}),
	};
};

ProtocolStepInput = function (protocol, data) {
	this.desc = ko.observable(data && data.desc);
	this.type = ko.observable(data && PODType.typeMap[data.type]);
	this.required = ko.observable(data ? data.required : true);
	this.multi = ko.observable(data ? !!data.multiParam : false);
	this.multiParam = ko.observable(data && _.find(protocol.params.peek(), function (param) {
		return param.name.peek() == data.multiParam;
	}));
}

ProtocolStepInput.prototype.types = PODType.types;

ProtocolStepInput.prototype.flatten = function () {
	return {
		desc: this.desc(),
		type: this.type().id,
		required: this.required(),
		multiParam: this.multi() ? this.multiParam().name() : null
	};
};

ProtocolProduct = function (protocol, data, tryUpdate) {
	var self = this;
	self.name = ko.observable(data && data.name);

	this.possibleTypes = _.map(Types.find().fetch(), function (type) {
		return protocol.manager.getType(type._id, undefined, type);
	});

	var typeMappings = { };
	self.types = ko.observableArray(data ? _.map(data.types, function (type) {
		var obj = protocol.manager.getType(type._id);
		if (type.v != obj.version) {
			if (!tryUpdate) {
				obj = protocol.manager.getType(type._id, type.v);
			} else if (obj.DBData.versionMappings) {
				_.each(obj.DBData.versionMappings, function (mapping) {
					if (!typeMappings[mapping.property.from._id]) typeMappings[mapping.property.from._id] = { };
					typeMappings[mapping.property.from._id][mapping.property.name] = mapping.source;
				});
			}
		}
		return obj;
	}) : [this.possibleTypes[0]]);

	self.allTypes = ko.computed({
		read: function () {
			var allTypes = { };

			_.each(self.types(), function (type) {
				allTypes[type._id()] = type;
				_.each(type.allBaseTypes(), function (baseType) {
					allTypes[baseType._id()] = baseType;
				});
			});

			return _.values(allTypes);
		},
		deferEvaluation: true,
	});

	self.propertyBindingsMap = { };
	self.propertyBindings = ko.computed({
		read: function () {
			var propertyBindings = [];
			var map = { };

			_.each(self.types(), function (type) {
				var usedTypes = { };

				_.each(type.allProperties(), function (property) {
					var fromId = property.from._id();
					var mapping;
					if (data && tryUpdate && typeMappings[fromId]) {
						var mapping = typeMappings[fromId][property.name()];
						if (mapping) fromId = mapping.from._id;
					}

					if (!map[fromId]) {
						if (!self.propertyBindingsMap[fromId]) self.propertyBindingsMap[fromId] = { };
						if (!self.propertyBindingsMap[fromId][property.name()]) {
							var ppp;

							if (data) {
								var md5Name = CryptoJS.MD5(ko.unwrap((mapping || property).name)).toString();

								if (data.propertyBindings[fromId] && data.propertyBindings[fromId][md5Name]) {
									ppp = new ProtocolProductProperty(protocol, property, data.propertyBindings[fromId][md5Name], type, tryUpdate);
								}
							}

							if (!ppp) ppp = new ProtocolProductProperty(protocol, property);
							self.propertyBindingsMap[fromId][property.name()] = ppp;
						}

						if (!usedTypes[fromId]) usedTypes[fromId] = [];
						usedTypes[fromId].push(self.propertyBindingsMap[fromId][property.name()]);
					}
				});

				_.extend(map, usedTypes);
			});

			return _.flatten(_.values(map));
		},
		deferEvaluation: false, // self.propertyBindingsMap must be populated for findPropertyBinding()
	});

	self.typeNames = ko.computed({
		read: function () {
			return _.invoke(self.types(), 'name').join(', ');
		},
		deferEvaluation: true,
	});
};

ProtocolProduct.prototype.findPropertyBinding = function (property) {
	return this.propertyBindingsMap[property.from._id()] && this.propertyBindingsMap[property.from._id()][property.name()];
};

ProtocolProduct.prototype.flatten = function () {
	var propertyBindings = this.propertyBindings();

	var propertyBindingsMap = { };
	_.each(propertyBindings, function (binding) {
		if (!propertyBindingsMap[binding.property.from._id()]) propertyBindingsMap[binding.property.from._id()] = { };
		propertyBindingsMap[binding.property.from._id()][CryptoJS.MD5(binding.property.name()).toString()] = binding.flatten();
	});

	return {
		name: this.name(),
		types: _.map(this.types(), function (type) {
			return type.toReference();
		}),
		allTypes: _.map(this.allTypes(), function (type) {
			return type.toReference();
		}),
		propertyBindings: propertyBindingsMap,
	};
};

ProtocolProductProperty = function (protocol, property, binding, type, tryUpdate) {
	var self = this;
	self.property = property;
	self.sourceType = ko.observable(binding ? binding.sourceType : 'ask');
	self.source = ko.observable();

	self.possibleSourceParamProperties = ko.computed({
		read: function () {
			var arr = [ ];

			_.each(protocol.params(), function (param) {
				if (!param.multi()) {
					_.each(param.type().allProperties(), function (paramProperty) {
						if (paramProperty.type() == property.type()) {
							arr.push(new ProtocolProductPropertyParamPropertySource(param, paramProperty));
						}
					});
				}
			});

			return arr;
		},
		deferEvaluation: true,
	});

	self.possibleSourceInputs = ko.computed({
		read: function () {
			var arr = [ ];

			_.each(protocol.steps(), function (step, stepIndex) {
				_.each(step.inputs(), function (input, inputIndex) {
					if (input.type() == property.type() && !input.multi()) {
						arr.push(new ProtocolProductPropertyInputSource(step, stepIndex, input, inputIndex));
					}
				});
			});

			return arr;
		},
		deferEvaluation: true,
	});

	self.possibleSources = ko.computed({
		read: function () {
			var arr = _.clone(self.possibleSourceParamProperties());
			arr.push.apply(arr, self.possibleSourceInputs());
			return arr;
		},
		deferEvaluation: true,
	});

	ko.computed(function () {
		switch (self.sourceType()) {
			case 'ask':
				self.source(new ProtocolProductPropertyAskSource(property));
				break;
			case 'paramProperty':
				var sourceTypeId = ko.unwrap((binding.source.paramProperty.from || type)._id);

				var sourceMapping;
				if (tryUpdate) {
					var sourceType = binding.source.paramProperty.from ? protocol.manager.getType(sourceTypeId, binding.source.paramProperty.from.v) : type;

					if (sourceType.oldVersion && sourceType.DBData.versionMappings) {
						sourceMapping = _.find(sourceType.DBData.versionMappings, function (mapping) {
							return mapping.source.from._id == sourceTypeId && mapping.source.name == binding.source.paramProperty.name;
						});
					}
				}
				var sourceFromId = sourceMapping ? sourceMapping.property.from._id : sourceTypeId;
				var sourceName = (sourceMapping ? sourceMapping.property : binding.source.paramProperty).name;
				self.source(_.find(self.possibleSourceParamProperties(), function (psource) {
					return psource.param.name() == binding.source.param && psource.paramProperty.from._id() == sourceFromId && psource.paramProperty.name() == sourceName;
				}));
				break;
			case 'input':
				self.source(_.find(self.possibleSourceInputs(), function (psource) {
					return psource.stepIndex == binding.source.step && psource.inputIndex == binding.source.input;
				}));
				break;
		};
	});

	if (tryUpdate && !self.source.peek() && property.required()) {
		protocol.autoUpdateFailed = true;
	}
};

ProtocolProductProperty.prototype.flatten = function () {
	return {
		property: this.property.toReference(),
		sourceType: this.sourceType(),
		source: this.source().flatten(),
	};
};

ProtocolProductPropertyAskSource = function () {
};

ProtocolProductPropertyAskSource.prototype.providesValue = function () {
	return false;
};

ProtocolProductPropertyAskSource.prototype.flatten = function () {
	return null;
};

ProtocolProductPropertyParamPropertySource = function (param, paramProperty) {
	var self = this;
	self.param = param;
	self.paramProperty = paramProperty;

	self.text = ko.computed({
		read: function () {
			return 'Property ' + paramProperty.name() + ' of parameter ' + param.name();
		},
		deferEvaluation: true,
	});
};

ProtocolProductPropertyParamPropertySource.prototype.providesValue = function (experiment) {
	var self = this;
	return ko.computed(function () {
		return ko.unwrap(experiment.params()[self.param.name()]).hasProperties;
	});
};

ProtocolProductPropertyParamPropertySource.prototype.getValue = function (experiment) {
	return experiment.params()[this.param.name()]().getProperty(this.paramProperty);
};

ProtocolProductPropertyParamPropertySource.prototype.flatten = function () {
	return {
		param: this.param.name(),
		paramProperty: this.paramProperty.toReference(),
	};
};

ProtocolProductPropertyInputSource = function (step, stepIndex, input, inputIndex) {
	var self = this;
	self.step = step;
	self.stepIndex = stepIndex;
	self.input = input;
	self.inputIndex = inputIndex;
	
	self.text = ko.computed({
		read: function () {
			return 'Input field ' + input.desc() + ' of step ' + (stepIndex + 1) + ' (' + step.desc() + ')';
		},
		deferEvaluation: true,
	});
};

ProtocolProductPropertyInputSource.prototype.providesValue = function (experiment) {
	return true;
};

ProtocolProductPropertyInputSource.prototype.getValue = function (experiment) {
	return ko.unwrap(experiment.values[this.stepIndex][this.inputIndex]);
};

ProtocolProductPropertyInputSource.prototype.flatten = function () {
	return {
		step: this.stepIndex,
		input: this.inputIndex,
	};
};

updateProtocol = function (id, newVersion, oldVersionNo) {
	Protocols.update(id, { $push: { v: newVersion }, $set: newVersion, $unset: { needsReview: true } });
	return {
		experiments: function () { return Experiments.find({ 'protocol._id': id, 'protocol.v': oldVersionNo }).fetch(); },
	};
};

Meteor.methods({
	insertProtocol: function (flat) {
		if (!this.userId) throw 403;

		flat.editor = this.userId;
		flat.mtime = new Date();

		return Protocols.insert(_.extend({
			v: [flat]
		}, flat));
	},
	updateProtocol: function (id, newVersion, oldVersionNo) {
		if (!this.userId) throw 403;

		var manager = new OMManager();

		newVersion.editor = this.userId;
		newVersion.mtime = new Date();

		cascadingUpdate(manager, updateProtocol(id, newVersion), {
			type: 'cascade',
			dependency: {
				type: 'protocol',
				id: id,
			}
		});
	},
});
