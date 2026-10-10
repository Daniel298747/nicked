import OpenAI from 'openai';
import { config } from '../config.js';
import { AppError } from '../utils/errors.js';

let client = null;

/** OpenRouter is OpenAI-compatible, so we use the OpenAI SDK pointed at OpenRouter's base URL. */
export function getOpenRouter() {
  if (!config.openrouter.apiKey) {
    throw new AppError('OPENROUTER_API_KEY is not set on the server.', 500, 'OPENROUTER_NOT_CONFIGURED');
  }
  client ??= new OpenAI({
    apiKey: config.openrouter.apiKey,
    baseURL: config.openrouter.baseURL,
    timeout: config.openrouter.timeoutMs,
    maxRetries: 2, // the SDK retries timeouts, 429s and 5xx with backoff
    defaultHeaders: {
      'HTTP-Referer': config.clientUrl,
      'X-Title': config.appName,
    },
  });
  return client;
}

/** For tests: point the client at a mock server. */
export function resetOpenRouterClient() {
  client = null;
}

/**
 * One chat completion. Returns the text plus usage so we can report cost per check.
 * `usage: { include: true }` asks OpenRouter to return the cost of the call.
 */
export async function chat({ model, messages, temperature = 0, maxTokens = 600 }) {
  const started = Date.now();
  const res = await getOpenRouter().chat.completions.create({
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    // Thinking models (e.g. qwen3.7-flash) otherwise spend the whole budget reasoning and return no content.
    reasoning: { enabled: false },
    usage: { include: true },
  });
  const content = res.choices?.[0]?.message?.content;
  const text = Array.isArray(content) ? content.map((p) => p.text || '').join('') : content || '';
  return {
    text,
    latencyMs: Date.now() - started,
    model: res.model || model,
    usage: {
      promptTokens: res.usage?.prompt_tokens || 0,
      completionTokens: res.usage?.completion_tokens || 0,
      cost: Number(res.usage?.cost) || 0,
    },
  };
}

/** Turns SDK errors into one line the owner (or a judge) can understand. */
export function describeAiError(err) {
  if (err instanceof AppError) return err.message;
  const status = err?.status;
  if (err?.name === 'APIConnectionTimeoutError' || /timed? ?out/i.test(err?.message || '')) {
    return `The AI check timed out after ${Math.round(config.openrouter.timeoutMs / 1000)}s.`;
  }
  if (err?.name === 'APIConnectionError') return "Couldn't reach OpenRouter. Check the internet connection.";
  if (status === 401) return 'OpenRouter rejected the API key.';
  if (status === 402) return 'The OpenRouter account is out of credits.';
  if (status === 404) return 'That model ID was not found on OpenRouter. Run `npm run models:list`.';
  if (status === 429) return 'OpenRouter rate limit hit. Try again in a minute.';
  if (status >= 500) return `OpenRouter or the model provider had an error (${status}).`;
  return `AI check failed: ${err?.message || 'unknown error'}`;
}

/** Errors where retrying other candidates is pointless. */
export function isFatalAiError(err) {
  return err instanceof AppError || [401, 402, 403, 404].includes(err?.status);
}
