import { createFileRoute } from '@tanstack/react-router';
import { ChatWorkspace } from '~/features/chat/components/ChatWorkspace';

export const Route = createFileRoute('/app/chat/$threadId')({
  component: ChatThreadRoute,
});

function ChatThreadRoute() {
  const { threadId } = Route.useParams();

  return <ChatWorkspace threadId={threadId} />;
}
