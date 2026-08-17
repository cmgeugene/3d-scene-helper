export const IS_E2E_TEST_BUILD = import.meta.env.MODE === 'e2e';

export const IS_EDITOR_TEST_BRIDGE_ENABLED =
  import.meta.env.DEV || IS_E2E_TEST_BUILD;
