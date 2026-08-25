import React, { useState, useEffect, useMemo, useCallback, createContext, useContext, useRef } from "react";
import { ToastProvider } from "./context/ToastContext";
import { DataProvider } from "./context/DataContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { AppShell } from "./layouts/AppShell";
import { LoginScreen, PasswordRecoveryScreen } from "./pages/auth/AuthPages";
import { Logo } from "./components/ui";


function SplashScreen() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <Logo size={68} />
    </div>
  );
}

function Root() {
  const auth = useAuth();
  if (auth.loading) return <SplashScreen />;
  if (auth.passwordRecovery) return <PasswordRecoveryScreen />;
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
