import { useEffect, useRef } from 'react';
import MessageBubble from './MessageBubble';

export interface Message {
  id: string;
  content: string;
  sender: 'user' | 'bot';
  timestamp: string;
}

interface MessageListProps {
  messages: Message[];
}

export default function MessageList({ messages }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-gray-400">Send a message to get started.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {messages.map((msg) => (
        <MessageBubble
          key={msg.id}
          content={msg.content}
          sender={msg.sender}
          timestamp={msg.timestamp}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
