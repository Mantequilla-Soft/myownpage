module.exports = {
  apps: [{
    name: 'snapie',
    script: './server.js',
    instances: 'max',   // one worker per CPU core (12 on this machine)
    exec_mode: 'cluster',
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production'
    }
  }]
};
