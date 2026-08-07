import { ConfigManager } from '@fuckclaw/config';
import { Logger } from '@fuckclaw/observability';
import { PersistenceLayer } from '@fuckclaw/persistence';
import { EventBus } from '@fuckclaw/event-bus';

async function bootstrap() {
  console.log('--- FuckClaw Milestone 1 Bootstrap ---');

  // 1. Load config
  const configManager = new ConfigManager({ logging: { level: 'debug' } });
  
  // 2. Initialize observability
  const logger = new Logger(configManager);
  logger.log({ level: 'info', message: 'Config loaded', metadata: configManager.get() });

  // 3. Initialize persistence
  const db = new PersistenceLayer(':memory:', logger);
  
  // 4. Initialize event bus
  const eventBus = new EventBus(db, logger);

  // Subscribe to verify dispatch
  eventBus.subscribe('system.booted', async (event) => {
    logger.log({ 
      level: 'info', 
      message: 'Received system.booted event via dispatch', 
      metadata: { eventId: event.id, payload: event.payload }
    });
  });

  // 5. Emit one typed event
  const eventId = await eventBus.emit('system.booted', { version: '1.0.0-milestone1' });
  logger.log({ level: 'info', message: 'Bootstrap sequence event emitted', metadata: { eventId } });

  // 6. Verify persistence
  const rows = db.query('SELECT id FROM events WHERE id = ?', [eventId]);
  logger.log({ level: 'info', message: 'Event persistence confirmed in SQLite', metadata: { rowCount: rows.length } });

  // 7. Shut down cleanly
  db.close();
  logger.log({ level: 'info', message: 'FuckClaw halted cleanly.' });
  console.log('--- Bootstrap Complete ---');
}

bootstrap().catch(err => {
  console.error('Fatal error during bootstrap:', err);
  process.exit(1);
});
