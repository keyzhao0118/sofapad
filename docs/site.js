// Both guides remain readable when JavaScript is unavailable.
const switcher = document.querySelector('.platform-switch');
const guides = [...document.querySelectorAll('[data-guide]')];
const buttons = [...document.querySelectorAll('[data-platform]')];
const hashPlatform = () => location.hash === '#macos-start' ? 'macos' : location.hash === '#windows-start' ? 'windows' : null;
function selectPlatform(platform) {
  for (const guide of guides) guide.hidden = guide.dataset.guide !== platform;
  for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.platform === platform));
}
if (switcher && guides.length === 2) {
  switcher.hidden = false;
  const platform = navigator.userAgentData?.platform ?? navigator.platform;
  selectPlatform(hashPlatform() ?? (/mac/i.test(platform) ? 'macos' : 'windows'));
  for (const button of buttons) button.addEventListener('click', () => selectPlatform(button.dataset.platform));
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href^="#"]');
    if (!link) return;
    const id = link.getAttribute('href');
    if (id === '#macos-start' || id === '#windows-start') {
      event.preventDefault();
      selectPlatform(id === '#macos-start' ? 'macos' : 'windows');
      history.pushState(null, '', id);
      document.querySelector(id).scrollIntoView({ block: 'start' });
    }
    const target = document.getElementById(id.slice(1));
    if (target?.tagName === 'DETAILS') target.open = true;
  });
  window.addEventListener('hashchange', () => { if (hashPlatform()) selectPlatform(hashPlatform()); });
}
if (location.hash === '#install-prompts') document.getElementById('install-prompts').open = true;
