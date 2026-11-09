module.exports = {
  apps: [
    {
      name: 'clawbot-agent',
      script: './node_modules/.bin/tsx',
      args: 'server/src/index.ts',
      cwd: __dirname,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 5178,
      },
    },
  ],
};
