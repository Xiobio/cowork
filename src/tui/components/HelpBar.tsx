import { Box, Text } from 'ink';

export function HelpBar() {
  return (
    <Box paddingX={1}>
      <Text dimColor>enter: send  ctrl+c: quit  /quit  /help  /clear</Text>
    </Box>
  );
}
