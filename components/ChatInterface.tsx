import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Icons } from './Icon';
import { ChatMessage, ChatSession } from '../types';

interface ChatInterfaceProps {
  chatSession: ChatSession | null;
  initialMessages: ChatMessage[];
  onHistoryUpdate: (msgs: ChatMessage[]) => void;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ chatSession, initialMessages, onHistoryUpdate }) => {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const updateStreamingMessage = (messageId: string, content: string) => {
    setMessages((prev) =>
      prev.map((message) => (message.id === messageId ? { ...message, content } : message))
    );
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || !chatSession || isTyping) return;

    const userMsg: ChatMessage = {
      role: 'user',
      content: input,
      id: Date.now().toString(),
    };

    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    onHistoryUpdate(newHistory);
    setInput('');
    setIsTyping(true);

    try {
      // Create placeholder for bot message
      const botMsgId = (Date.now() + 1).toString();
      const botMsg: ChatMessage = {
        role: 'model',
        content: '',
        id: botMsgId,
        isStreaming: true
      };
      
      setMessages(prev => [...prev, botMsg]);

      // Stream response
      const result = await chatSession.sendMessageStream({ message: userMsg.content, history: newHistory });
      
      let fullContent = '';
      for await (const chunk of result) {
        const text = chunk.text;
        if (text) {
          fullContent += text;
          updateStreamingMessage(botMsgId, fullContent);
        }
      }

      // Finalize message
      const finalHistory = [
        ...newHistory, 
        { ...botMsg, content: fullContent, isStreaming: false }
      ];
      setMessages(finalHistory);
      onHistoryUpdate(finalHistory);

    } catch (error) {
      console.error("Chat Error:", error);
      const errorMsg: ChatMessage = {
        role: 'model',
        content: "**Error:** Failed to send message. Please try again.",
        id: Date.now().toString()
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex flex-col h-[600px] bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-slate-50">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-4 opacity-50">
            <Icons.BookOpen size={48} />
            <p>Ask The Master Tutor for details, clarifications, or quizzes.</p>
          </div>
        )}
        
        {messages.map((msg) => (
          <div 
            key={msg.id} 
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div 
              className={`
                max-w-[85%] md:max-w-[75%] rounded-2xl p-4 shadow-sm text-sm leading-relaxed
                ${msg.role === 'user' 
                  ? 'bg-primary-600 text-white rounded-br-none' 
                  : 'bg-white text-slate-800 border border-slate-200 rounded-bl-none prose prose-sm prose-slate'
                }
              `}
            >
              {msg.role === 'user' ? (
                <div className="whitespace-pre-wrap">{msg.content}</div>
              ) : (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                  components={{
                    table: ({node, ...props}) => (
                      <div className="overflow-x-auto my-3">
                        <table className="min-w-full border border-slate-200 text-sm" {...props} />
                      </div>
                    ),
                    thead: ({node, ...props}) => <thead className="bg-slate-50" {...props} />,
                    th: ({node, ...props}) => (
                      <th
                        className="border border-slate-200 px-2.5 py-1.5 text-left font-semibold text-slate-700"
                        {...props}
                      />
                    ),
                    td: ({node, ...props}) => (
                      <td className="border border-slate-200 px-2.5 py-1.5 align-top text-slate-700" {...props} />
                    )
                  }}
                >
                  {msg.content}
                </ReactMarkdown>
              )}
              {msg.isStreaming && (
                 <span className="inline-block w-2 h-4 ml-1 bg-slate-400 animate-pulse align-middle"></span>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 bg-white border-t border-slate-200">
        <form onSubmit={handleSubmit} className="relative flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a follow-up question..."
            className="w-full max-h-32 min-h-[50px] py-3 px-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none text-sm"
            style={{ height: 'auto' }}
          />
          <button
            type="submit"
            disabled={!input.trim() || isTyping}
            className={`
              p-3 rounded-xl flex-shrink-0 transition-all
              ${!input.trim() || isTyping 
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
                : 'bg-primary-600 text-white hover:bg-primary-700 shadow-sm'
              }
            `}
          >
            {isTyping ? <Icons.Loader2 className="animate-spin" size={20} /> : <Icons.UploadCloud className="rotate-90" size={20} />}
          </button>
        </form>
        <div className="text-center mt-2">
           <p className="text-[10px] text-slate-400">AI can make mistakes. Check important info.</p>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;
