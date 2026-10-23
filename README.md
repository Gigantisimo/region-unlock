# Region Unlock

Два независимых инструмента для Google Flow и Antigravity из неподдерживаемых регионов на Windows.

> **Только для личного использования.** Проект не связан с Google. Обход региональных ограничений может нарушать Terms of Service и привести к блокировке аккаунта. Используйте на свой риск. Инструменты снимают только клиентскую региональную проверку: они **не** открывают платные функции, не увеличивают квоты и не обходят лимиты usage.

## Состав

| Папка | Инструмент | Платформа |
| --- | --- | --- |
| [`flow-unlock/`](flow-unlock/) | Chrome MV3-расширение для Flow | Chrome / Edge (desktop) |
| [`antigravity/`](antigravity/) | PowerShell-патч `language_server.exe` | Windows x64 |

## Быстрый старт

### Flow

1. Открой `chrome://extensions`, включи **Developer mode**.
2. **Load unpacked** → выбери папку `flow-unlock`.
3. Открой <https://flow.google.com/> и закрепи расширение.
4. Бейдж `OK` — патч применён. Если `ERR` — открой попап и нажми «Перезапустить».

Подробности: [`flow-unlock/README.md`](flow-unlock/README.md).

### Antigravity

1. Полностью закрой Antigravity (включая иконку в трее).
2. Проверь, что скрипт находит гейт:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\antigravity\patch.ps1 -DryRun
   ```

3. Пропатчи:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\antigravity\patch.ps1
   ```

4. Опционально отключи автообновление, чтобы патч не затёрся:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\antigravity\disable-autoupdate.ps1
   ```

5. Запусти Antigravity и войди в аккаунт.

Откат: `.\antigravity\patch.ps1 -Restore`.

Подробности: [`antigravity/README.md`](antigravity/README.md).

## Как это работает

- **Flow.** Расширение через `chrome.debugger` перехватывает основной бандл `AiSandboxAngularFrontend` с `www.gstatic.com` и заменяет вызов регионального флага `_.X(a,31)` на `true`. Возрастной флаг `_.X(a,32)` не трогается. Кэш отключён, данные никуда не отправляются.
- **Antigravity.** Скрипт находит в локальном `language_server.exe` x64-гейт `cmp byte [rax+8],0; je` и меняет результат на `1` (`mov byte [rax+8],1; nop; nop`). Это убирает клиентское сообщение о регионе. Серверные проверки аккаунта и квоты остаются как есть.

## Требования

- Windows 10/11, PowerShell 5.1+
- Antigravity 2.25.0 (протестировано; скрипт ищет сигнатуру, а не смещение)
- Chrome или Edge 111+ для расширения

## Ограничения

- Google может изменить бандл Flow или код Antigravity — тогда инструменты перестанут находить сигнатуру и безопасно откажутся работать.
- Регион и доступность аккаунта всё ещё проверяются на сервере. VPN может понадобиться.
- Автообновление Antigravity затирает патч; для сохранения отключи его отдельным скриптом.
- Никакой телеметрии. Оба инструмента работают локально.

## Лицензия

MIT. См. [`LICENSE`](LICENSE).

## Связь

Telegram: [@ultravibecoder](https://t.me/ultravibecoder)

