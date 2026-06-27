import { useEffect, useRef } from 'react';
import {
  Animated, EmitterSubscription, Keyboard, KeyboardEvent, Platform,
} from 'react-native';

type Options = {
  factor?: number;
  maxLift?: number;
};

export default function useKeyboardLift(options: Options = {}) {
  const { factor = 0.35, maxLift = 180 } = options;
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const prefix = Platform.OS === 'ios' ? 'keyboardWill' : 'keyboardDid';

    const animateTo = (toValue: number, duration = 250) => {
      Animated.timing(translateY, {
        toValue,
        duration,
        useNativeDriver: true,
      }).start();
    };

    const onShow = (event: KeyboardEvent) => {
      const height = event.endCoordinates?.height || 0;
      const lift = Math.min(maxLift, Math.round(height * factor));
      animateTo(-lift, event.duration || 250);
    };

    const onHide = (event: KeyboardEvent) => {
      animateTo(0, event.duration || 220);
    };

    const listeners: EmitterSubscription[] = [
      Keyboard.addListener(`${prefix}Show`, onShow),
      Keyboard.addListener(`${prefix}Hide`, onHide),
    ];

    return () => {
      listeners.forEach((listener) => listener.remove());
    };
  }, [factor, maxLift, translateY]);

  return { transform: [{ translateY }] };
}
