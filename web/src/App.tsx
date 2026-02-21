import { AuthenticatedTemplate, UnauthenticatedTemplate } from '@azure/msal-react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import LoginPage from './components/auth/LoginPage';
import ChatPage from './components/chat/ChatPage';

export default function App() {
  return (
    <BrowserRouter>
      <UnauthenticatedTemplate>
        <LoginPage />
      </UnauthenticatedTemplate>

      <AuthenticatedTemplate>
        <Layout>
          <Routes>
            <Route path="/" element={<ChatPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </AuthenticatedTemplate>
    </BrowserRouter>
  );
}
