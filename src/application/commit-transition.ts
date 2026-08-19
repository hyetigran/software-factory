import type {
  AuthorityPort,
  PersistableTransition,
  PersistTransitionRequest,
} from "./authority-port.js";

export type CommitTransitionRequest<TState extends object> =
  PersistTransitionRequest & {
    transition: (previousState: TState | null) => PersistableTransition<TState>;
  };

export async function commitTransition<TState extends object>(
  authority: AuthorityPort,
  request: CommitTransitionRequest<TState>,
): Promise<PersistableTransition<TState>> {
  return authority.transaction((transaction) => {
    const previousState = transaction.loadRun<TState>(request.runId);
    const result = request.transition(previousState);
    transaction.persist(request, result);
    return result;
  });
}
