import { ConfigManager } from '@fuckclaw/config';
import { Logger } from '@fuckclaw/observability';
import { PersistenceLayer } from '@fuckclaw/persistence';
import { EventBus } from '@fuckclaw/event-bus';
import { SystemEvent } from '@fuckclaw/core';

async function bootstrap() {
  console.log('Booting FuckClaw Milestone 1...');

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
  eventBus.subscribe('system.booted', async (event: SystemEvent) => {
    logger.log({ 
      level: 'info', 
      message: 'Received system.booted event', 
      metadata: { eventId: event.id }
    });
  });

  // 5. Emit one typed event
  const eventId = await eventBus.emit('system.booted', { version: '1.0.0-milestone1' });
  logger.log({ level: 'info', message: 'Bootstrap sequence completed', metadata: { eventId } });

  // Verify persistence
  const rows = db.query<{ id: string }>('SELECT id FROM events WHERE id = ?', [eventId]);
  logger.log({ level: 'info', message: 'Event persistence verified', metadata: { rowCount: rows.length } });

  // 6. Shut down cleanly
  db.close();
  logger.log({ level: 'info', message: 'FuckClaw halted cleanly.' });
}

bootstrap().catch(err => {
  console.error('Fatal error during bootstrap:', err);
  process.exit(1);
});
