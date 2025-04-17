import { createContext, useContext, useState } from 'react';

const UserContext = createContext(null);
export const useUser = () => useContext(UserContext);

export function UserProvider({ children }) {
  const [user, setUser] = useState(null); // e.g. { username: 'jane', role: 'creator' }

  return (
    <UserContext.Provider value={{ user, setUser }}>
      {children}
    </UserContext.Provider>
  );
}
