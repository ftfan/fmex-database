// const dev = argv.env === 'dev';
const watch = ['./dist/'];

/**
 * Application configuration section
 * http://pm2.keymetrics.io/docs/usage/application-declaration/
 */
module.exports = {
  apps: [
    {
      name: 'fmex-database',
      cwd: __dirname,
      script: `dist/index.js`,
      max_restarts: 5, // 重启次数
      exec_mode: 'fork',
      instances: 1, // 实例个数
      max_memory_restart: '2048M',
      ignore_watch: ['node_modules', 'logs', '.git', '.eslintrc'],
      watch,
    },
  ],
};
