import { useMsal } from '@azure/msal-react';

export default function UserBadge() {
  const { instance, accounts } = useMsal();
  const account = accounts[0];

  if (!account) return null;

  const handleLogout = () => {
    instance.logoutRedirect();
  };

  return (
    <div className="flex items-center gap-3">
      <div className="text-right">
        <p className="text-sm font-medium text-gray-900">{account.name || 'User'}</p>
        <p className="text-xs text-gray-500">{account.username}</p>
      </div>
      <button
        onClick={handleLogout}
        className="rounded-md px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100"
      >
        Sign out
      </button>
    </div>
  );
}
