import React, { useState } from 'react';
import { View, Text, TextInput, Alert } from 'react-native';
import { Screen, Box, Btn, s } from '../ui';
import { C } from '../theme';
import { login } from '../api';

// A01 로그인
export default function Login({ onLogin }) {
  const [center, setCenter] = useState('수원소방서 영동');
  const [empId, setEmpId] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const r = await login(center, empId, pw);
      onLogin(r);
    } catch (e) {
      Alert.alert('로그인 실패', e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={{ marginTop: 60, alignItems: 'center', gap: 8 }}>
        <View style={{ width: 64, height: 64, borderRadius: 16, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 22 }}>ER</Text>
        </View>
        <Text style={{ fontSize: 22, fontWeight: '800', color: C.ink }}>ER-Sync</Text>
      </View>
      <Box label="센터">
        <TextInput style={s.value} value={center} onChangeText={setCenter} />
      </Box>
      <Box label="사번">
        <TextInput style={s.value} value={empId} onChangeText={setEmpId} autoCapitalize="none" placeholder="사번 입력" />
      </Box>
      <Box label="비밀번호">
        <TextInput style={s.value} value={pw} onChangeText={setPw} secureTextEntry placeholder="비밀번호 입력" />
      </Box>
      <Btn title="로그인" color={C.navy} onPress={submit} loading={busy} />
    </Screen>
  );
}
