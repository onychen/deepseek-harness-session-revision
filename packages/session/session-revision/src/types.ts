/** Browser-safe request and result vocabulary for session history revision. */

/** Common compare-and-set fields for one history revision. */
export interface SessionRevisionRequest {
  /** Raw sequence of the eligible message selected by the user. */
  readonly targetSeq: number
  /** Raw tail sequence observed when the action was offered. */
  readonly expectedLastSeq: number
  /** IANA time zone of the initiating client. */
  readonly timezone: string
  /** Confirms that effects caused by discarded tool calls remain external. */
  readonly acknowledgeToolEffects?: boolean
}

/** Edit request replacing all text blocks of one ordinary user prompt. */
export interface SessionRevisionEditRequest extends SessionRevisionRequest {
  /** Replacement prompt text. */
  readonly text: string
}

/** Stable refusal returned without mutating the session. */
export interface SessionRevisionRejectedResult {
  readonly kind: 'rejected'
  readonly code: 'busy' | 'stale' | 'invalid-target' | 'subagent-session' | 'attachment-unavailable' | 'model-incompatible'
  readonly message: string
}

/** Tool-effect confirmation required before the same operation may commit. */
export interface SessionRevisionConfirmationResult {
  readonly kind: 'confirmation-required'
  readonly expectedLastSeq: number
  readonly message: string
}

/** Committed revision, including persistence as an independent outcome. */
export interface SessionRevisionCommittedResult {
  readonly kind: 'committed'
  readonly retractSeq: number
  readonly persistence: 'persisted' | 'failed'
  readonly persistenceError?: string
}

/** Result of an edit or regenerate request. */
export type SessionRevisionResult =
  | SessionRevisionRejectedResult
  | SessionRevisionConfirmationResult
  | SessionRevisionCommittedResult
