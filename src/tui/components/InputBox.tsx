import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  disabled: boolean;
  statusHint: string;
  width: number;
}

export function InputBox({ value, onChange, onSubmit, disabled, statusHint, width }: Props) {
  const line = '─'.repeat(Math.max(1, width - 2));
  return (
    <Box flexDirection="column">
      <Text dimColor>{line}</Text>
      <Box paddingX={1}>
        {disabled ? (
          <Box>
            <Text color="yellow"><Spinner type="dots" /></Text>
            <Text dimColor> {statusHint}</Text>
          </Box>
        ) : (
          <Box>
            <Text color="cyan" bold>&gt; </Text>
            <TextInput value={value} onChange={onChange} onSubmit={onSubmit} placeholder="" />
          </Box>
        )}
      </Box>
      <Text dimColor>{line}</Text>
    </Box>
  );
}
