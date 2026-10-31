const path = require('node:path');
const catalog = require('../backend/models/gallery-example-catalog');
module.exports = {...catalog,mediaDir:path.resolve(__dirname,'../backend/runtime/gallery-example-publish')};
if (require.main === module) { catalog.checkManifest(); console.log('Gallery catalog and bundled thumbnails verified.'); }
