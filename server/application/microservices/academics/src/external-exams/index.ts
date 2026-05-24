/**
 * external-exams module — public re-exports.
 *
 * D.4 / D.5 / D.6 controllers + services that read/write the
 * registration state machine import the helper from here so the helper
 * stays an internal concern of this module (not common/utils).
 */

export {
  validateTransition,
  getAllowedTransitions,
  isLegalForward,
  type TransitionResult,
} from './external-exam-registration.state-machine';

export { ExternalExamsModule } from './external-exams.module';
