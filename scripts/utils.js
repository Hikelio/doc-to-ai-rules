const VERBOSE = false;

function log(...args) {
    if (VERBOSE) {
        console.log(...args);
    }
}

module.exports = { log }; 