import { useMsal } from '@azure/msal-react';
import { loginRequest } from '../../config/msal';

export default function LoginPage() {
  const { instance } = useMsal();

  const handleLogin = () => {
    instance.loginRedirect(loginRequest);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow-md">
        <h1 className="mb-2 text-center text-2xl font-bold text-gray-900">
          Recert Assistant
        </h1>
        <p className="mb-6 text-center text-sm text-gray-500">
          Sign in with your organization account to continue.
        </p>
        <button
          onClick={handleLogin}
          className="w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Sign in with Microsoft
        </button>
      </div>
    </div>
  );
}
