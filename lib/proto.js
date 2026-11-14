class Defer {    
    get isDefered() { return !!this._isDefered ; }
    set isDefered(v) { this._isDefered = v; }
    
    get promise() { return this._promise ; }
    set promise(v) { this._promise = v; }
    /**
     * 
     * @param {Number} timeout 
     */
    constructor(timeout) {
        
        this._promise = new Promise((resolve, reject) => {
            this._resolve = resolve;
            this._reject = reject;
        });
        
        if(timeout!==undefined) {
            setTimeout(function () {
                if(!this.isDefered && this.promise && this.promise.resolve) this.promise.resolve();
            }.bind(this),timeout);
        }
        
        // this.isFulfilled = function() { return isFulfilled; };
        // this.isPending = function() { return isPending; };
        // this.isRejected = function() { return isRejected; };
    }
    then(fun) { this._promise.then(fun); }
    catch(fun) { this._promise.catch(fun); }
    finally(fun) { this._promise.finally(fun); }
    resolve(val1,val2,val3,val4) { this.isDefered=true; this._resolve(val1,val2,val3,val4); }
    reject(val1,val2,val3,val4) { this.isDefered=true; this._reject(val1,val2,val3,val4); }
}


/** Deep equality for JSON values; object key order is ignored. */
function jsonEqual(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) return a.length === b.length && a.every((value, i) => jsonEqual(value, b[i]));
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length
        && keys.every(key => Object.prototype.hasOwnProperty.call(b, key) && jsonEqual(a[key], b[key]));
}

module.exports = { Defer, jsonEqual };