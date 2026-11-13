import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C } from './theme';

export function Screen({ children }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.card }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Title({ children }) {
  return <Text style={s.h2}>{children}</Text>;
}

// 왼쪽 상단 이전(←) 버튼 + 제목
export function Header({ title, onBack }) {
  return (
    <View style={s.header}>
      {onBack ? (
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} style={s.back} accessibilityLabel="이전 화면">
          <Text style={s.backArrow}>←</Text>
        </TouchableOpacity>
      ) : null}
      <Text style={s.h2}>{title}</Text>
    </View>
  );
}

export function Box({ label, children, style }) {
  return (
    <View style={[s.box, style]}>
      {label ? <Text style={s.small}>{label}</Text> : null}
      {children}
    </View>
  );
}

export function Btn({ title, onPress, color = C.blue, disabled, loading }) {
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      disabled={disabled || loading}
      onPress={onPress}
      style={[s.btn, { backgroundColor: disabled ? C.gray : color }]}
    >
      <Text style={s.btnText}>{loading ? '처리 중…' : title}</Text>
    </TouchableOpacity>
  );
}

export function Chip({ text, on, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} style={[s.chip, on && { backgroundColor: C.blue }]}>
      <Text style={[s.chipText, on && { color: '#fff' }]}>{text}</Text>
    </TouchableOpacity>
  );
}

export const s = StyleSheet.create({
  screen: { flexGrow: 1, padding: 18, gap: 12 },
  h2: { fontSize: 20, fontWeight: '800', color: C.ink },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  back: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.surf, alignItems: 'center', justifyContent: 'center' },
  backArrow: { fontSize: 20, color: C.ink, fontWeight: '700', marginTop: -2 },
  box: { backgroundColor: C.surf, borderRadius: 12, padding: 12 },
  small: { fontSize: 11, color: C.mut, marginBottom: 4 },
  value: { fontSize: 15, color: C.ink, padding: 0 },
  btn: { marginTop: 'auto', borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  chip: { backgroundColor: C.chip, borderRadius: 10, paddingVertical: 5, paddingHorizontal: 11, marginRight: 6, marginBottom: 6 },
  chipText: { color: C.blue, fontSize: 13, fontWeight: '600' },
  row: { flexDirection: 'row', flexWrap: 'wrap' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: { width: '48%' },
});
