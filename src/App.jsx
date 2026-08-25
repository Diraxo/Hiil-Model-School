import React, { useState, useEffect, useMemo, useCallback, createContext, useContext, useRef } from "react";
import { ToastProvider } from "./context/ToastContext";
import { DataProvider } from "./context/DataContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { AppShell } from "./layouts/AppShell";
import { LoginScreen } from "./pages/auth/AuthPages";


function Root() {
  const auth = useAuth();
  if (!auth.currentUser) return <LoginScreen />;
  return <AppShell />;
}

function TilmaanApp() {
  return (
    <ToastProvider>
      <DataProvider>
        <AuthProvider>
          <Root />
        </AuthProvider>
      </DataProvider>
    </ToastProvider>
  );
}

export default TilmaanApp;
