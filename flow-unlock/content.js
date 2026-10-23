(function () {
  'use strict';

  function ping(type) {
    try {
      chrome.runtime.sendMessage({ type: type, url: location.href });
    } catch (e) {}
  }

  ping('FLOW_CSPING');

  window.addEventListener('load', function () {
    setTimeout(function () {
      try {
        if (location.pathname.indexOf('unsupported-country') !== -1) {
          ping('FLOW_REPATCH');
        }
      } catch (e) {}
    }, 3000);
  });
})();
