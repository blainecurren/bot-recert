import { useState, useCallback } from 'react';
import MessageList, { type Message } from './MessageList';
import MessageInput from './MessageInput';
import api from '../../config/api';

let nextId = 1;

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [sending, setSending] = useState(false);

  const handleSend = useCallback(async (text: string) => {
    const userMsg: Message = {
      id: String(nextId++),
      content: text,
      sender: 'user',
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setSending(true);

    try {
      const { data } = await api.post('/chat', { message: text });

      const botMsg: Message = {
        id: String(nextId++),
        content: data.reply,
        sender: 'bot',
        timestamp: data.timestamp,
      };

      setMessages((prev) => [...prev, botMsg]);
    } catch {
      const errMsg: Message = {
        id: String(nextId++),
        content: 'Sorry, something went wrong. Please try again.',
        sender: 'bot',
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setSending(false);
    }
  }, []);

  return (
    <div className="flex h-full flex-col">
      <MessageList messages={messages} />
      <MessageInput onSend={handleSend} disabled={sending} />
    </div>
  );
}
