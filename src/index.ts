import { config } from './config';
import { logger } from './utils/logger';
import app from './server';

app.listen(config.port, () => {
  logger.info({ port: config.port }, 'Server started');
});
