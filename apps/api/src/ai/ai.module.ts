import { Module } from '@nestjs/common';
import { AiGateway } from './ai-gateway.service';
import { CachedLlmProvider } from './cached-llm-provider';
import { LLM_PROVIDER } from './llm-provider';

/**
 * AI gateway (04 §4.2 `ai`). `LLM_PROVIDER=none` binds no live adapter; vendor adapters are added
 * here once OD-02's vendor is chosen. The urgency module must never import this module (G-2).
 */
@Module({
  providers: [AiGateway, CachedLlmProvider, { provide: LLM_PROVIDER, useValue: null }],
  exports: [AiGateway],
})
export class AiModule {}
