interface MessageBubbleProps {
  content: string;
  sender: 'user' | 'bot';
  timestamp: string;
}

export default function MessageBubble({ content, sender, timestamp }: MessageBubbleProps) {
  const isUser = sender === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2.5 ${
          isUser
            ? 'bg-blue-600 text-white'
            : 'bg-white text-gray-900 shadow-sm border border-gray-200'
        }`}
      >
        <p className="text-sm whitespace-pre-wrap">{content}</p>
        <p
          className={`mt-1 text-xs ${
            isUser ? 'text-blue-200' : 'text-gray-400'
          }`}
        >
          {new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
}
