supplyVersionVM = function(id, version, index) {
	var self = this;
	self.id = id;
	self.versionNr = index;
	self.version = version;
	self.href = Router.path('viewSupply', { id: self.id }, { query: { v: self.versionNr } });
}

supplyVersionVM.prototype.isCurrent = function(currentVersionNr) {
	return this.versionNr == currentVersionNr;

}

supplyVersionVM.prototype.hideModal = function() {
	$("#versionsModal").modal('hide');
	return true; // Allow standard event handler for href
}

supplyVM = function (data) {
	var self = this;
	self.editMode = data.editMode;
	self.data = data.supply && data.supply();
	self.id = self.data && self.data._id;
	self.version = self.data && (typeof data.version() == 'undefined' ? self.data.v.length - 1 : data.version());
	self.oldVersion = self.data && self.data.v && typeof data.version() != 'undefined' && data.version() != self.data.v.length - 1;
	self.versions = self.data && _.map(self.data.v, function(version, index) {
		return new supplyVersionVM(self.id, version, index);
	}).reverse();
	self.types = ko.observableArray(self.data ? _.filter(this.possibleTypes(), function (ptype) {
		return _.some(self.data.v[self.version].types, function (type) {
			return ptype._id() == type._id;
		});
	}) : []);

	var propertyMap = { };
	self.properties = ko.computed(function () {
		var map = { };
		console.log("self.data.v[self.version]",self.data.v[self.version], "self.data.types()", self.data.types);
		_.each(self.types(), function (type) {
			_.each(type.allProperties(), function (property) {
				if (!property.from) property.from = type;

				if (!propertyMap[property.from._id()]) propertyMap[property.from._id()] = { };
				if (!propertyMap[property.from._id()][property.name()]) propertyMap[property.from._id()][property.name()] = {
					from: _.pick(property.from, '_id', 'name'),
					name: property.name,
					value: ko.observable(self.data && self.data.v[self.version].properties[property.from._id()] && self.data.v[self.version].properties[property.from._id()][CryptoJS.MD5(property.name()).toString()].value)
				};

				if (!map[property.from._id()]) map[property.from._id()] = { };
				map[property.from._id()][property.name()] = propertyMap[property.from._id()][property.name()];
			});
		});

		return _.flatten(_.map(map, _.values));
	});

	self.source = ko.observable(self.data && self.data.v[self.version].source);

	self.date = ko.observable(self.data ? self.data.v[self.version].date : new Date());
	self.dateUpdate = !self.data && setInterval(function () {
		self.date(new Date());
	}, 1000);

	self.notes = ko.observable(self.data && self.data.v[self.version].notes);
};

supplyVM.prototype.possibleTypes = ko_meteor_find(Types, { });

supplyVM.prototype.flatten = function () {
	var allTypes = { };
	_.each(this.types(), function (type) {
		allTypes[type._id()] = _.pick(type, '_id', 'name');
		_.each(type.allBaseTypes(), function (baseType) {
			allTypes[baseType._id()] = _.pick(baseType, '_id', 'name');
		});
	});

	var properties = { };
	_.each(this.properties(), function (property) {
		if (!properties[property.from._id()]) properties[property.from._id()] = { };
		properties[property.from._id()][CryptoJS.MD5(property.name()).toString()] = property;
	});

	return ko.toJS({
		types: _.map(this.types(), function (type) {
			var obj = _.pick(type, '_id', 'name');
			obj.text = '';''
			_.each(type.text(), function (part) {
				switch (part.type()) {
					case 'text':
						obj.text = obj.text + part.text();
						break;
					case 'propertyReference':
						obj.text = obj.text + properties[(part.property.from || type)._id()][CryptoJS.MD5(part.property.name()).toString()].value();
						break;
				}
			});
			return obj;
		}),
		allTypes: ko.toJS(_.values(allTypes)),
		properties: properties,
		source: this.source,
		date: this.date,
		notes: this.notes,
		mtime: new Date()
	});
};

supplyVM.prototype.save = function () {
	clearInterval(this.dateUpdate);
	var flat = this.flatten();

	if (!this.id) {
		this.id = Supplies.insert(_.extend({
			v: [flat]
		}, flat));
	} else if (!isUnchanged(flat, this.data)) {
		Meteor.call('updateSupply', this.id, flat);
	}

	if (Meteor.isClient) Router.go('viewSupply', { id: this.id });
	return this.data ? this.data.v.length : 0;
};

supplyVM.prototype.edit = function () {
	Router.go('viewSupply', { id: this.id }, { query: { edit: 1 } });
};

supplyVM.prototype.cancel = function () {
	if (this.id) {
		Router.go('viewSupply', { id: this.id });
	} else {
		Router.go('suppliesList');
	}
};

supplyVM.prototype.displayVersions = function() {
	$("#versionsModal").modal();
}

Meteor.methods({
	'updateSupply': function (id, newVersion) {
		Supplies.update(id, { $push: { v: newVersion }, $set: newVersion }, function (error) {
			Experiments.find({ sourceSupplies: id }).forEach(function (dependentExperiment) {
				var protocol = Protocols.findOne(dependentExperiment.protocol._id);
				var vm = new experimentVM({ experiment: dependentExperiment, protocol: protocol });
				vm.save(dependentExperiment.v[dependentExperiment.v.length - 1].performer, {
					type: 'cascade',
					dependency: {
						type: 'supply',
						id: id
					}
				});
			});
		});
	}
});