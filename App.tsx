import React, { useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';

import WelcomeAuthScreen from './WelcomeAuthScreen';
import { auth, db } from './lib/firebase';
import EventsFeedScreen from './screens/EventsFeedScreen';
import { UserRole } from './types/auth';

const PROFILE_LOOKUP_RETRIES = 5;
const PROFILE_LOOKUP_DELAY_MS = 450;

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const resolveUserRole = async (uid: string): Promise<UserRole | null> => {
  for (let attempt = 0; attempt < PROFILE_LOOKUP_RETRIES; attempt += 1) {
    const userSnapshot = await getDoc(doc(db, 'users', uid));

    if (userSnapshot.exists()) {
      const role = userSnapshot.data().role;
      return role === 'organization' ? 'organization' : 'volunteer';
    }

    if (attempt < PROFILE_LOOKUP_RETRIES - 1) {
      await sleep(PROFILE_LOOKUP_DELAY_MS);
    }
  }

  return null;
};

export default function App() {
  const [isBooting, setIsBooting] = useState(true);
  const [currentUserRole, setCurrentUserRole] = useState<UserRole | null>(null);
  const [appError, setAppError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      let isMounted = true;

      const syncSession = async () => {
        setAppError(null);

        if (!user) {
          if (isMounted) {
            setCurrentUserRole(null);
            setIsBooting(false);
          }
          return;
        }

        try {
          const resolvedRole = await resolveUserRole(user.uid);

          if (!isMounted) {
            return;
          }

          if (!resolvedRole) {
            setAppError('Не удалось загрузить профиль пользователя. Попробуйте снова.');
            setCurrentUserRole(null);
            setIsBooting(false);
            return;
          }

          setCurrentUserRole(resolvedRole);
          setIsBooting(false);
        } catch {
          if (!isMounted) {
            return;
          }

          setAppError('Не удалось загрузить данные аккаунта.');
          setCurrentUserRole(null);
          setIsBooting(false);
        }
      };

      syncSession();

      return () => {
        isMounted = false;
      };
    });

    return unsubscribe;
  }, []);

  if (isBooting) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator color="#243BD7" size="large" />
        <Text style={styles.loadingText}>Загружаем Volunet...</Text>
      </SafeAreaView>
    );
  }

  if (currentUserRole) {
    return (
      <View style={styles.appContainer}>
        {appError ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{appError}</Text>
          </View>
        ) : null}
        <EventsFeedScreen currentUserRole={currentUserRole} />
      </View>
    );
  }

  return <WelcomeAuthScreen />;
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F6F6F2',
  },
  loadingText: {
    marginTop: 14,
    fontSize: 15,
    fontWeight: '600',
    color: '#4D5472',
  },
  appContainer: {
    flex: 1,
    backgroundColor: '#F6F6F2',
  },
  banner: {
    marginHorizontal: 18,
    marginTop: 10,
    marginBottom: -6,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: '#FFF1F3',
    borderWidth: 1,
    borderColor: 'rgba(196, 56, 76, 0.16)',
    zIndex: 2,
  },
  bannerText: {
    color: '#B3374E',
    fontSize: 13,
    fontWeight: '600',
  },
});
