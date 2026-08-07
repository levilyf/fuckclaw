import { IObservability } from '@fuckclaw/observability';
import { ScheduleTrigger, WebhookRequest, WebhookResponse } from '../types.js';

export class WebhookHandler {
  constructor(
    private logger: IObservability,
    private onTriggerDue: (trigger: ScheduleTrigger, eventContext: Record<string, unknown>) => Promise<string | undefined>
  ) {}

  async handleWebhook(
    triggers: ScheduleTrigger[],
    request: WebhookRequest
  ): Promise<WebhookResponse> {
    const matchingTrigger = triggers.find(
      (t) =>
        t.enabled &&
        t.source.type === 'webhook' &&
        t.source.path === request.path &&
        (!t.source.method || t.source.method.toUpperCase() === request.method.toUpperCase())
    );

    if (!matchingTrigger || matchingTrigger.source.type !== 'webhook') {
      return {
        statusCode: 404,
        message: `No webhook trigger found matching path: ${request.path} [${request.method}]`,
      };
    }

    // Secret verification if configured
    if (matchingTrigger.source.secret) {
      const authHeader =
        (request.headers?.['authorization'] as string) ||
        (request.headers?.['x-webhook-secret'] as string) ||
        '';

      const providedToken = authHeader.replace(/^Bearer\s+/i, '').trim();
      if (providedToken !== matchingTrigger.source.secret) {
        this.logger.log({
          level: 'warn',
          message: `Unauthorized webhook attempt for trigger ${matchingTrigger.id}`,
        });
        return {
          statusCode: 401,
          message: 'Unauthorized: Invalid webhook secret',
        };
      }
    }

    try {
      const taskId = await this.onTriggerDue(matchingTrigger, {
        body: request.body,
        headers: request.headers,
        receivedAt: Date.now(),
      });

      return {
        statusCode: 200,
        message: `Webhook accepted and task submitted for trigger "${matchingTrigger.name}"`,
        taskId,
      };
    } catch (err: any) {
      this.logger.log({
        level: 'error',
        message: `Failed to process webhook for trigger ${matchingTrigger.id}`,
        metadata: { error: err.message || String(err) },
      });
      return {
        statusCode: 500,
        message: `Internal error processing webhook: ${err.message || String(err)}`,
      };
    }
  }
}
