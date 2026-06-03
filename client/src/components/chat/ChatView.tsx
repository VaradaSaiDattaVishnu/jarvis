import CoreOrb from './CoreOrb';
import MessageList from './MessageList';
import ChatInput from './ChatInput';

export default function ChatView() {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <CoreOrb />
      <MessageList />
      <ChatInput />
    </div>
  );
}
