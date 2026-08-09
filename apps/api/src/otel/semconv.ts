/**
 * OpenInference attribute names.
 *
 * Two backends are in scope and they do not read the same vocabulary. Phoenix
 * only understands OpenInference. Langfuse understands OpenInference, the
 * OpenTelemetry GenAI conventions and OpenLLMetry. OpenInference is therefore
 * the only vocabulary both sides read, so it is the one we emit — which is what
 * lets `OTEL_BACKEND` switch between them without touching instrumentation.
 *
 * Spelled out as constants rather than imported from `@arizeai/openinference-
 * semantic-conventions` on purpose: that package exists to support Arize's own
 * instrumentations, and taking a vendor dependency to name ~20 strings would
 * couple a Langfuse deployment to Arize's release cycle for no benefit.
 *
 * @see https://github.com/Arize-ai/openinference/blob/main/spec/semantic_conventions.md
 */

/** The attribute Phoenix and Langfuse both switch on to classify a span. */
export const SPAN_KIND = 'openinference.span.kind'

/**
 * Span kinds. Only the ones this system can actually produce are listed —
 * there is no retriever, embedding or reranker anywhere in the journey.
 *
 * An object rather than an enum: the workspace sets `isolatedModules`, which
 * rules out `const enum`, and a plain string union is what the OTel attribute
 * wants anyway.
 */
export const Kind = {
  /** A step that orchestrates other steps. The default for our own spans. */
  Chain: 'CHAIN',
  /** A model call. */
  Llm: 'LLM',
  /** A tool invocation, whether the model chose it or our code did. */
  Tool: 'TOOL',
  /** An agent's own reasoning loop. */
  Agent: 'AGENT',
  /** Anything that scores an output — used by the eval judges. */
  Evaluator: 'EVALUATOR',
} as const

export type Kind = (typeof Kind)[keyof typeof Kind]

/** Free-form input/output payloads, rendered as the span's body in both UIs. */
export const INPUT_VALUE = 'input.value'
export const INPUT_MIME = 'input.mime_type'
export const OUTPUT_VALUE = 'output.value'
export const OUTPUT_MIME = 'output.mime_type'

export const MIME_JSON = 'application/json'
export const MIME_TEXT = 'text/plain'

/** Model call detail. */
export const LLM_MODEL = 'llm.model_name'
export const LLM_PROVIDER = 'llm.provider'
export const LLM_INVOCATION_PARAMS = 'llm.invocation_parameters'
export const LLM_TOKEN_PROMPT = 'llm.token_count.prompt'
export const LLM_TOKEN_COMPLETION = 'llm.token_count.completion'
export const LLM_TOKEN_TOTAL = 'llm.token_count.total'

/**
 * Messages are indexed attributes, not a nested object: OTel attribute values
 * are scalars or arrays of scalars, so a conversation is flattened into
 * `llm.input_messages.0.message.role` and friends.
 */
export const llmInputMessage = (i: number, field: 'role' | 'content') =>
  `llm.input_messages.${i}.message.${field}`
export const llmOutputMessage = (i: number, field: 'role' | 'content') =>
  `llm.output_messages.${i}.message.${field}`

/** Tool call detail. */
export const TOOL_NAME = 'tool.name'
export const TOOL_DESCRIPTION = 'tool.description'
export const TOOL_PARAMETERS = 'tool.parameters'

/**
 * Groups traces into a conversation.
 *
 * Our unit of tracing is one turn, not one session — a session lives as long as
 * the browser tab and would otherwise produce a single unclosed span for the
 * whole demo. `session.id` is what stitches those per-turn traces back together,
 * and both backends key their session view off it.
 */
export const SESSION_ID = 'session.id'

/** Arbitrary JSON blob, shown as metadata in both UIs. */
export const METADATA = 'metadata'

/** Searchable labels. Array-valued. */
export const TAGS = 'tag.tags'

/**
 * Langfuse's own hint for how to display a span.
 *
 * Additive and safely ignored by Phoenix. Worth setting because Langfuse's
 * OpenInference mapping infers `span` for anything it cannot classify, and a
 * generation shown as a plain span loses the token and cost columns.
 */
export const LANGFUSE_OBSERVATION_TYPE = 'langfuse.observation.type'

/** Our own namespace, for the domain facts no standard covers. */
export const CAR_PHASE = 'car.phase'
export const CAR_DRIVER = 'car.driver'
export const CAR_RANKED_BY = 'car.ranked_by'
export const CAR_CANDIDATES = 'car.candidates'
export const CAR_SHORTLIST_SIZE = 'car.shortlist_size'
export const CAR_LISTING_ID = 'car.listing_id'
export const CAR_STEP_LABEL = 'car.step.label'
export const CAR_STEP_DETAIL = 'car.step.detail'

/** Cross-reference back to the Agents SDK's own trace, for support questions. */
export const AGENTS_TRACE_ID = 'openai.agents.trace_id'
export const AGENTS_SPAN_ID = 'openai.agents.span_id'
