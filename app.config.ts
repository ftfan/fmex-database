export const AppConfig = {
  AliOss: {
    region: '<oss region>',
    accessKeyId: '<Your accessKeyId>',
    accessKeySecret: '<Your accessKeySecret>',
    bucket: '<Your bucket name>',
  },

  CacheControl: 'max-age=315360000000',
};

try {
  const UserConf = require('./my.config.js');
  Object.assign(AppConfig, UserConf);
} catch (e) {
  //
}
