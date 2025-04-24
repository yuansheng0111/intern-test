import pino from 'pino';

const transport = pino.transport({
  targets: [
    {
      target: 'pino-pretty',
      level: process.env.LOG_LEVEL || 'info',
      options: {
        colorize: true,
        singleLine: true,
        translateTime: 'SYS:HH:MM:ss.SSS',
        ignore: 'pid,hostname',
      },
    },
    {
      target: 'pino/file',
      level: process.env.LOG_LEVEL || 'info',
      options: {
        destination: './app.log',
        mkdir: true, // create the directory if it doesn't exist
      },
    },
  ],
});

const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  transport,
);

export default logger;
