const tg = window.Telegram?.WebApp;

export function useTelegram() {
  const user = tg?.initDataUnsafe?.user;

  return {
    tg,
    user,
    telegramId: user?.id || null,
    firstName: user?.first_name || 'Client',
    username: user?.username || null,
    colorScheme: tg?.colorScheme || 'dark',
    showMainButton: (text, onClick) => {
      if (!tg) return;
      tg.MainButton.setText(text);
      tg.MainButton.onClick(onClick);
      tg.MainButton.show();
    },
    hideMainButton: () => tg?.MainButton.hide(),
    showBackButton: (onClick) => {
      if (!tg) return;
      tg.BackButton.onClick(onClick);
      tg.BackButton.show();
    },
    hideBackButton: () => tg?.BackButton.hide(),
    haptic: (type = 'light') => tg?.HapticFeedback?.impactOccurred(type),
    close: () => tg?.close(),
    isInTelegram: !!tg?.initData
  };
}
