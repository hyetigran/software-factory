import type {
  PersistableTransition,
  PersistTransitionRequest,
  SqliteAuthority,
} from "../infrastructure/sqlite/authority.js";

export type CommitTransitionRequest<TState extends object> =
  PersistTransitionRequest & {
    transition: (previousState: TState | null) => PersistableTransition<TState>;
  };

export async function commitTransition<TState extends object>(
  authority: SqliteAuthority,
  request: CommitTransitionRequest<TState>,
): Promise<PersistableTransition<TState>> {
  await authority.beginMutation();
  try {
    const previousState = authority.loadRun<TState>(request.runId);
    const result = request.transition(previousState);
    authority.persistAcceptedTransition(request, result);
    authority.commitMutation();
    return result;
  } catch (error) {
    authority.rollbackMutation(error);
    throw error;
  }
}
