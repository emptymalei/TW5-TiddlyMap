/*\

title: $:/plugins/felixhayashi/tiddlymap/view_abstraction.js
type: application/javascript
module-type: library

@module TiddlyMap
@preserve

\*/

(/** @lends module:TiddlyMap*/function() {

  /**************************** IMPORTS ****************************/

  var EdgeType = require("$:/plugins/felixhayashi/tiddlymap/edgetype.js").EdgeType;
    
  /***************************** CODE ******************************/

  /**
   * This class abstracts the various pieces that together make up the
   * view such as map, edge filter, node filter, config etc.
   * If {@code isCreate} is not specified, the viewAbstraction will only
   * represent the view and not create it or any missing part of it.
   * 
   * @param {string|ViewAbstraction|Tiddler} view - The view
   * @param {boolean} [isCreate] - True if the view should be created and override
   *     any existing view, false otherwise.
   * @constructor
   */
  var ViewAbstraction = function(view, isCreate) {

    // register shortcuts and aliases
    this.createShortcuts();

    if(view instanceof ViewAbstraction) {
      // bounce back the object we received
      return view;
    }

    // start building paths
    
    // attention: path is only allowed to have direct child properties
    // otherwise the rebuild mechanism would need a change.
    this.path = this.utils.getDataMap(); 
    this.path.config = this._getConfigPath(view);
          
    if(isCreate) {
      this._createView();
    } else if(!this.exists()) { // no valid config path
      return; // skip initialization
    }
    
    this.path.map = this.path.config + "/map";
    this.path.nodeFilter = this.path.config + "/filter/nodes";
    this.path.edgeFilter = this.path.config + "/filter/edges";
    
    // If a view component was deliberately changed by the owner
    // of the ViewAbstraction instance this hashmap is used to
    // prevent rebuildCache() from rebuilding the parts of the
    // cache again (which is already up to date).
    this._ignoreOnNextRebuild = this.utils.getDataMap();
    
    // force complete rebuild
    this.rebuildCache(this.utils.getValues(this.path));
    
  };
  
  /**
   * Create shortcuts and aliases
   */
  ViewAbstraction.prototype.createShortcuts = function() {
    this.wiki = $tw.wiki;
    this.opt = $tw.tmap.opt;
    this.logger = $tw.tmap.logger;
    this.utils = $tw.tmap.utils;
  };

  /**
   * Will try to translate the constructor param into the config path.
   * 
   * @private
   * @param {*} view - The constructor param to abstract or create the view.
   * @result {string|undefined} The path or undefined if translation failed.
   */
  ViewAbstraction.prototype._getConfigPath = function(view) {

    if(view instanceof $tw.Tiddler) { // is a tiddler object
      return view.fields.title;
    }
    
    if(typeof view == "string") { // is string
        
      // remove prefix and slash
      view = this.utils.getWithoutPrefix(view, this.opt.path.views + "/");

      if(!this.utils.hasSubString(view, "/")) { // contains no slash; valid label
        return this.opt.path.views + "/" + view; // add prefix (again)
      }
    }
    
  };

  /**
   * A hashmap of all paths (tiddler titles) that make up this view.
   * 
   * @return {Hashmap} The paths.
   */
  ViewAbstraction.prototype.getPaths = function() {
    return this.path;
  };

  /**
   * Will create the config tiddler which means that the view will start
   * existing.
   * 
   * @private
   */
  ViewAbstraction.prototype._createView = function() {
    
    // destroy any former view
    if(this.exists()) { // I am alive!
      this.destroy(); // ...now die!
    }
    
    // create new view
    var fields = {};
    fields.title = this.path.config;
    fields[this.opt.field.viewMarker] = true;
    fields.id = this.utils.genUUID(); // you never know when you will need it
    
    this.wiki.addTiddler(new $tw.Tiddler(fields));
    
  };
  
  ViewAbstraction.prototype.isLocked = function() {
    
    return this.wiki.isShadowTiddler(this.path.config);
    
  };

  /**
   * This method will use the keys provided in `changedTiddlers` to
   * decide whether or not to update some parts of the cache.
   * 
   * @see ViewAbstraction#rebuildCache
   * 
   * @param {Hashmap<TiddlerReference, *>} changedTiddlers - A list of
   *     tiddlers that trigger a rebuild unless they are already up-to-date.
   * @return {Array<TiddlerReference> - A list of tiddlers that got updated.
   */
  ViewAbstraction.prototype.refresh = function(changedTiddlers) {
    return this.rebuildCache(Object.keys(changedTiddlers));
  }

  /**
   * This method will rebuild the cache based on the references provided
   * via `components`. If a part (component) of the cache is marked as
   * being already up-to-date, then it is skipped. 
   * 
   * A special case is when the view's config tiddler changed
   * (corresponding to `this.path.config`). Since config changes often
   * affect the whole view's thinking, it makes sense to blindly
   * do a full rebuild! Yet, full rebuild always ignores any component
   * that is internally listet as up-to-date.
   * 
   * @param {Array<TiddlerReference>} components - A list of
   *     tiddler references that refer to components managed by the view.
   * @param {boolean} isForceRebuild - Do not selectively rebuild the
   *     cache but rebuild everything no matter what.
   * @return {Array<TiddlerReference>} - A list of tiddlers that got updated.
   */
  ViewAbstraction.prototype.rebuildCache = function(components, isForceRebuild) {
    
    if(!this.exists()) return [];

    if(this.utils.inArray(this.path.config, components)) {
      this.logger("debug", "Reloading config of view", this.getLabel(),  "; trigger full rebuild");
      components = this.utils.getValues(this.path);
    }

    // dereference the ignore list as it might get freshly updated
    // when some setters are called during this rebuild phase.
    var ignoredOnCurRebuild = this._ignoreOnNextRebuild;
    this._ignoreOnNextRebuild = this.utils.getDataMap();

    var modified = [];
    
    for(var i = 0; i < components.length; i++) {
      var tRef = components[i];

      if(!isForceRebuild && ignoredOnCurRebuild[tRef]) {
        continue; // skip changes when already up to date
        
      } else if(tRef === this.path.config) {
        this.config = this.getConfig(null, true);
        
      } else if(tRef === this.path.map) {
        this.positions = this.getPositions(true);
        
      } else if(tRef === this.path.nodeFilter) {
        this.nodeFilter = this.getNodeFilter(null, true);
        
      } else if(tRef === this.path.edgeFilter) {
        this.edgeFilter = this.getEdgeFilter(null, true);
        this.typeWhiteList = this.getTypeWhiteList(true);
        // TODO: Maybe set flag to prevent allowed edge types to be updated during this refresh
        
      } else if(this.utils.startsWith(tRef, this.opt.path.edgeTypes)) {
        this.typeWhiteList = this.getTypeWhiteList(true);
        
      } else {
        continue; // prevents an entry in "modified" list
      }
      
      modified.push(tRef);
      
    }
    
    return modified;
    
  };

  /**
   * A view exists if the constructor parameter was successfully
   * translated into a {@link TiddlerReference} that corresponds to
   * an existing view tiddler in the store.
   * 
   * @return {boolean} True if it exists, false otherwise.
   */
  ViewAbstraction.prototype.exists = function() {
    return this.utils.tiddlerExists(this.path.config);
  };

  /**
   * The path to the config tiddler that represents the view.
   * 
   * @return {TiddlerReference} The view path.
   */
  ViewAbstraction.prototype.getRoot = function() {
    return this.path.config;
  };
  
  /**
   * Returns this view's creation date.
   * 
   * @param {boolean} [asString] True if the returned value should be
   *     a string in any case.
   * @return {string|object|undefined} The creation date in the specified
   *     output format.
   */
  ViewAbstraction.prototype.getCreationDate = function(asString) {
    
    if(!this.exists()) return;
    
    var val = this.wiki.getTiddler(this.path.config).fields["created"];
    if(asString) { 
      // note: th will be translated as well!
      return (val instanceof Date
              ? $tw.utils.formatDateString(val, "DDth MMM YYYY")
              : "");
    }
    
    return val;
    
  };

  /**
   * The label of the view (which is basically the roots basename).
   * 
   * @return {string} The label (name) of the view.
   */
  ViewAbstraction.prototype.getLabel = function() {

    if(!this.exists()) return; // TODO not nice
    
    return this.utils.getBasename(this.path.config);
  };

  /**
   * Method to remove all tiddlers prefixed with the views root. This
   * will make the view non-existent.
   */
  ViewAbstraction.prototype.destroy = function() {
    
    if(!this.exists()) return;
    
    // delete the view and all tiddlers stored in its path (map, edge-filter etc.)
    var filter = "[prefix[" + this.getRoot() + "]]";
    this.utils.deleteTiddlers(this.utils.getMatches(filter));
    
    this.path = this.utils.getDataMap();
    
  };

  ViewAbstraction.prototype.getReferences = function() {
    
    var filter = "[regexp:text[<\\$tiddlymap.*?view=." + this.getLabel() + "..*?>]]";
    return this.utils.getMatches(filter);
    
  };
    
  ViewAbstraction.prototype.rename = function(newLabel) {

    if(!this.exists() || typeof newLabel !== "string") {
      return;
    }
    
    if(this.utils.inArray("/", newLabel)) {
      $tw.tmap.notify("A view name must not contain any \"/\"");
      return;
    }
    
    var oldLabel = this.getLabel();
    
    if(oldLabel === newLabel) {
      return;
    }

    for(index in this.path) {
      
      var tObj = this.wiki.getTiddler(this.path[index]);

      if(!tObj) continue;
      
      this.path[index] = this.path[index].replace(oldLabel, newLabel);
      this.wiki.addTiddler(new $tw.Tiddler(tObj, { title : this.path[index] }));
      this.wiki.deleteTiddler(tObj.fields.title);
      
    }
    
    this.rebuildCache(this.utils.getValues(this.path), true); // true => force rebuild
    
  };

  /**
   * All configurations that are toggled via checkboxes to have a value
   * either `true` or `false` can be accessed via this method.
   * 
   * @param {string} name - The configs name without the `_config` prefix.
   * @return {boolean} True if the configuration is enabled, false otherwise.
   */
  ViewAbstraction.prototype.isEnabled = function(name) {
    
    return this.utils.isTrue(this.getConfig(name), false);
    
  };
  
  /**
   * Returns a configuration value relating to the given name. If no name
   * is given, an object with all configurations is returned.
   * 
   * @param {string} [name] - Instead of all configurations being returned,
   *     only the configuration named name is returned. The initial "config."
   *     may be omitted.
   * @param {boolean} [isRebuild] - True if to rebuild the cache, false otherwise.
   * @result {string|Object} If `type` is not specified an object containing
   *     all configurations is returned, otherwise a single value will be returned.
   */
  ViewAbstraction.prototype.getConfig = function(name, isRebuild, defValue) {
    
    if(!this.exists()) {
      var config = this.utils.getDataMap();
    } else if(!isRebuild && this.config) {
      var config = this.config;
    } else {
      var fields = this.wiki.getTiddler(this.path.config).fields;
      var config = this.utils.getPropertiesByPrefix(fields, "config.");
      defaults = {
        "config.layout.active": "user"
      };
      $tw.utils.extend(defaults, config);
    }
    
    return (name
            ? config[(this.utils.startsWith(name, "config.") ? name : "config." + name)]
            : config);
    
  };
  
  /**
   * The returned value suggests a maximum number of iterations before
   * vis displays the graph. It is related to the previous number of
   * iterations the network needed to stabilize.
   * 
   * @return {number} The suggested number of iterations.
   */
  ViewAbstraction.prototype.getStabilizationIterations = function() {
    return (this.stabIterations ? this.stabIterations : 1000);
  };
  
  ViewAbstraction.prototype.setStabilizationIterations = function(i) {
    
  };
  
  
  /**
   * If the active layout is set to *hierarchical*, this function will
   * return all edges that define the hierarchical order of this view.
   * If the layout is not set to *hierarchical*, an empty array is
   * returned.
   * 
   * @return {Array<string>} A list of edge labels of edges that define
   *     the hierarchy.
   */
  ViewAbstraction.prototype.getHierarchyEdgeTypes = function() {
    
    if(this.getConfig("layout.active") !== "hierarchical") return [];
    
    var orderByEdges = this.utils.getPropertiesByPrefix(this.getConfig(), "config.layout.hierarchical.order-by-", true);
    
    var labels = this.utils.getDataMap();
    for(var id in orderByEdges) {
      if(orderByEdges[id] === "true") {
        var tObj = this.utils.getTiddler($tw.tmap.indeces.tById[id]);
        if(tObj) {
          labels[this.utils.getBasename(tObj.fields.title)] = true;
        }
      }
    }
          
    return labels;
    
  };

  /**
   * 
   */
  ViewAbstraction.prototype.setConfig = function() {
    
    if(arguments[0] == null) return; // null or undefined
    
    if(arguments.length === 1 && typeof arguments[0] === "object") {
      
      for(var prop in arguments[0]) {
        this.setConfig(prop, arguments[0][prop]);
      }
      
    } else if(arguments.length === 2 && typeof arguments[0] === "string") {
      
      var prop = this.utils.getWithoutPrefix(arguments[0], "config.");
      var val = arguments[1];
      
      if(val === undefined) {
        return;
      }
      
      if(val === null) {
        this.logger("debug", "Removing config", prop);
        delete this.config["config."+prop];
      } else {
        if(prop === "edge_type_namespace" && typeof val === "string" && val.length) {
          // if the user left out the colon, we will add it!
          val = val.replace(/([^:])$/, "$1:");
        }
      }
      
      this.logger("log", "Setting config", prop, val);
      this.config["config."+prop] = val;

      
    } else { // not allowed
      return;
    }
    
    // save
    this.wiki.addTiddler(new $tw.Tiddler(
      this.wiki.getTiddler(this.path.config), this.config
    ));

    this._ignoreOnNextRebuild[this.path.config] = true;
    
  };
  
  ViewAbstraction.prototype.isExplicitNode = function(node) {
    return this.getNodeFilter("expression")
               .match(this.utils.escapeRegex(this._getAddNodeFilterPart(node)));
  };
  
  ViewAbstraction.prototype.isLiveView = function(node) {
    return (this.getLabel() === this.opt.misc.liveViewLabel);
  };
  
  /**
   * 
   */
  ViewAbstraction.prototype.removeNodeFromFilter = function(node) {
    
    if(!this.isExplicitNode(node)) return false;
      
    var curExpr = this.getNodeFilter("expression");
    var newFilter = curExpr.replace(this._getAddNodeFilterPart(node), "");
                   
    this.setNodeFilter(newFilter);
    return true;
    
  };
  
  ViewAbstraction.prototype._getAddNodeFilterPart = function(node) {
    var test = "[bla:";
    return "[field:" + this.opt.field.nodeId + "[" + node.id + "]]";
  };

  /**
   * Sets and rebuilds the node filter according to the expression provided.
   * 
   * @param {string} expr - A tiddlywiki filter expression.
   */
  ViewAbstraction.prototype.setNodeFilter = function(expr, force) {
    
    if(!this.exists()) return;
        
    expr = expr.replace("\n", " ");
    
    if(this.getNodeFilter.expression === expr) { // already up to date;
      // This check is critical to prevent recursion!
      return;
    }
    
    if(this.isLiveView() && !force) {
      $tw.tmap.notify("It is forbidden to change the node filter of the live view!");
      return;
    }
        
    this.utils.setField(this.path.nodeFilter, "filter", expr);
    
    this.logger("debug","Node filter set to", expr);

    // rebuild filter now and prevent another rebuild at refresh
    this.nodeFilter = this.getNodeFilter(null, true);
    this._ignoreOnNextRebuild[this.path.nodeFilter] = true;
    
  };
  
  ViewAbstraction.prototype.setEdgeFilter = function(expr) {
    
    if(!this.exists()) return;
    
    expr = expr.replace("\n", " ");
    
    if(this.getEdgeFilter.expression === expr) { // already up to date
      // This check is critical to prevent recursion!
      return;
    }
    
    this.utils.setField(this.path.edgeFilter, "filter", expr);
    
    this.logger("debug","Edge filter set to", expr, this.path.edgeFilter);

    // rebuild filter now and prevent another rebuild at refresh
    this.edgeFilter = this.getEdgeFilter(null, true);
    this._ignoreOnNextRebuild[this.path.edgeFilter] = true;
    
  }; 

  /**
   * Method to append a filter part to the current filter (*or*-style).
   * 
   * @param {string} A tiddlywiki filter expression.
   */
  ViewAbstraction.prototype.appendToNodeFilter = function(filter) {
    
    var filter = this.getNodeFilter("expression") + " " + filter;
    this.setNodeFilter(filter);
    
  };

  ViewAbstraction.prototype.addNodeToView = function(node) {
    
    this.appendToNodeFilter(this._getAddNodeFilterPart(node));
    this.setNodePosition(node);
    
  };

  /**
   * Method will return a tiddlywiki edge filter that is used to
   * decide which edge types are displayed by the graph.
   * 
   * @param {("expression"|"compiled")} [type] - Use this param to control the output.
   * @param {boolean} [isRebuild] - True if to rebuild the cache, false otherwise.
   * @result {TiddlyWikiFilter|Object} If `type` is not specified an object containing
   *     both types as properties is returned.
   *     Note: If the view doesn't exist, the filter will be empty and not match anything.
   */
  ViewAbstraction.prototype.getEdgeFilter = function(type, isRebuild) {
    
    if(!isRebuild && this.edgeFilter) {
      
      var filter = this.edgeFilter;
      
    } else {
      
      var filter = this.utils.getDataMap();

      var tObj = this.wiki.getTiddler(this.path.edgeFilter);
      filter.expression = (tObj && tObj.fields.filter
                           ? tObj.fields.filter
                           : this.opt.filter.defaultEdgeFilter);
      
      filter.compiled = this.wiki.compileFilter(filter.expression);
      
    }
      
    return (type ? filter[type] : filter);
    
  };
  
  /**
   * 
   */
  ViewAbstraction.prototype.getTypeWhiteList = function(isRebuild) {
    
    if(!isRebuild && this.typeWhiteList) {
      
      return this.typeWhiteList;
      
    } else {
      
      var typeWhiteList = this.utils.getDataMap();
      
      var source = this.utils.getMatches(this.opt.selector.allEdgeTypes);
      var matches = this.utils.getMatches(this.getEdgeFilter("compiled"), source);
      for(var i = 0; i < matches.length; i++) {
        var type = this.utils.getWithoutPrefix(matches[i], this.opt.path.edgeTypes + "/");
        typeWhiteList[type] = new EdgeType(type);
      }
      
      return typeWhiteList;
      
    }
  };

  /**
   * Method will return a tiddlywiki node filter that is used to
   * decide which nodes are displayed by the graph.
   * 
   * @param {("expression"|"compiled")} [type] - Use this param to control the output.
   * @param {boolean} [isRebuild] - True if to rebuild the cache, false otherwise.
   * @result {TiddlyWikiFilter|Object} If `type` is not specified an object containing
   *     both types as properties is returned.
   *     Note: If the view doesn't exist, the filter will be empty and not match anything.
   */
  ViewAbstraction.prototype.getNodeFilter = function(type, isRebuild) {

    if(!isRebuild && this.nodeFilter) {
      
      var filter = this.nodeFilter;
      
    } else {
      
      var filter = this.utils.getDataMap();
      var tObj = this.wiki.getTiddler(this.path.nodeFilter);
      filter.expression = (tObj && tObj.fields.filter ? tObj.fields.filter : "");
      filter.compiled = this.wiki.compileFilter(filter.expression);
      
    }

    return (type ? filter[type] : filter);

  };

  /**
   * This method will return the positions stored in the view. Even positions
   * of nodes that do not exist anymore are kept.
   * 
   * @todo When to delete obsolete positions?
   * 
   * @param {boolean} [isRebuild] - True if to rebuild the cache, false otherwise.
   * @result {Hashmap<Id, Position>} A Hashmap with node positions.
   *     Note: If the view doesn't exist, the hashmap will be empty.
   */
  ViewAbstraction.prototype.getPositions = function(isRebuild) {
    
    if(!this.isLiveView() && !isRebuild && this.positions) {
      return this.positions;
    }
    
    // cannot use prototypeless hashmap here
    var positions = this.utils.parseFieldData(this.getPositionStore(), "text", {});
    this.logger("debug", "Loading positions", positions, "from", this.getPositionStore());
    
    return positions;
    
  };

  /**
   * This function will store the given positions into the views map.
   * 
   * @param {Hashmap<Id, Position>} positions - A Hashmap with node positions
   *     which can be of course also `Hashmap.<Id, Node>`.
   */
  ViewAbstraction.prototype.setPositions = function(positions) {
    
    if(!this.exists() || typeof positions !== "object") return;
        
    $tw.tmap.logger("log", "Storing positions in", this.getPositionStore());
    this.utils.writeFieldData(this.getPositionStore(), "text", positions);
    
    // cache new values and prevent rebuild at refresh
    this.positions = positions;
    this._ignoreOnNextRebuild[this.path.map] = true;
    
      
  };
  
  ViewAbstraction.prototype.getPositionStore = function() {
    
    if(this.isLiveView()) {
      
      var tRef = this.utils.getMatches(this.getNodeFilter("compiled"))[0];
      if(tRef) {
        // use a dedicated store for each focussed tiddler
        return (this.path.map + "/" + $tw.tmap.indeces.idByT[tRef]);
      }
      
    }
     
    // use the global store
    return this.path.map;
      
  };

  /**
   * Will store a single nodes position in the view.
   * 
   * @param {Node} node - A node with x, y coordinates.
   */
  ViewAbstraction.prototype.setNodePosition = function(node) {
      
    if(node && node.x && node.y) {
      var pos = this.getPositions();
      pos[node.id] = { x: node.x, y: node.y };
      this.setPositions(pos);
    }
    
  };
  
  // !! EXPORT !!
  exports.ViewAbstraction = ViewAbstraction;
  // !! EXPORT !!#
  
})();