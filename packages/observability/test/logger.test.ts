import { describe, it, expect, vi } from 'vitest';
import { Logger } from '../src/index.js';
import { ConfigManager } from '@fuckclaw/config';

describe('Logger', () => {
  it('should log messages according to configured level', () => {
    const config = new ConfigManager({ logging: { level: 'info' } });
    const logger = new Logger(config);
    
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    
    logger.log({ level: 'debug', message: 'invisible' });
    expect(consoleSpy).not.toHaveBeenCalled();
    
    logger.log({ level: 'info', message: 'visible' });
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    
    consoleSpy.mockRestore();
  });
});
