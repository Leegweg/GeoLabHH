/*  app.js  –  Open-Door 514-Zeilen-Version + Grün + Journal  */
import config from './js/config.js';
import du from './js/domutils.js';
import i18n from './js/i18n.js';
import Labs from './js/labs.js';
import Location from './js/location.js';
import Map from './js/map.js';
import QrCode from './js/qr-code.js';
import st from './js/settings.js';

console.log(config.name, config.version);

const MESSAGES = [];
let SW_REGISTRATION = null;
let HREF_CURR = '';
let HREF_PREV = '';

const send_message_to_service_worker = (data) => new Promise((resolve) => {
    navigator.serviceWorker.ready.then(reg => { reg.active.postMessage(data); resolve(reg); });
});

function addMessage(msg) {
    du.setInnerHtml('messages', msg);
    MESSAGES.unshift({timestamp: Date.now(), text: msg});
    if (MESSAGES.length > config.message_buffer) MESSAGES.length = config.message_buffer;
}

/* -------------  USER-UPDATE – ALLES FREI  ------------- */
const updateUser = () => Labs.getData().then(res => {
    config.username = res.username || 'guest';
    config.user_id  = res.user_id;
    config.expire   = res.membership_expire;
    config.level    = 255;                       // alle Bits
    config.level_formatted = 'bit-all';
    config.translator = res.translator;

    du.setChecked('authenticated', true);        // sofort frei
    du.setChecked('update', res.update);
    document.querySelectorAll('[for="debug"]').forEach(e => e.classList.remove('hidden'));

    du.setInnerHtml('friends-formatted', config.level_formatted);

    if (config.translator.length) {
        document.querySelectorAll('[for="translate"]').forEach(e => e.classList.remove('hidden'));
        st.getSetting('data-url').then(u => {
            const url = (u || config.data_url) + (u.includes('?') ? '&' : '?');
            i18n.supported_url  = url + 'special=language';
            i18n.translations_url = url + 'special=language&id=@@';
        }).then(() => st.getSetting('language'))
          .then(l => i18n.setLanguageSelector(i18n.selector_id, l))
          .then(() => i18n.setTranslations());
    } else {
        document.querySelectorAll('[for="translate"]').forEach(e => e.classList.add('hidden'));
        i18n.supported_url  = i18n._supported_url;
        i18n.translations_url = i18n._translations_url;
        du.setChecked('translate', false);
    }
    return res;
});

const sentNotification = (title, payload) => {
    if (SW_REGISTRATION && 'showNotification' in SW_REGISTRATION) return SW_REGISTRATION.showNotification(title, payload);
    return new Notification(title, payload);
};

const notify = d => Labs.labs && Labs.labs.filter(l => l.distance < d && l.color !== 'yellow' && !l.notified)
                                       .forEach(l => {
                                           l.notified = true;
                                           Labs.getDetail(l.id).then(v => sentNotification(l.title, {
                                               body: v.question, badge: './images/badge.png', icon: './images/icons/icon-512-512.png',
                                               image: l.key_image_url, tag: l.id, vibrate: [100, 200, 100, 100, 200, 100, 100, 200, 100, 100, 200, 100], data: v
                                           }));
                                       });

const changedPositionLarge = () => {
    const p = new Location(localStorage.getItem(config.current_latitude), localStorage.getItem(config.current_longitude));
    addMessage('changedPositionLarge: ' + p);
    return Labs.getLabs().then(() => Labs.showLabs()).finally(() => {
        ['latitude', 'longitude', 'timestamp'].forEach(k => localStorage.setItem(config['fetched_' + k], localStorage.getItem(config['current_' + k])));
    });
};

const changedPositionSmall = () => {
    Labs.showLabs(Labs.sortLabs());
    st.getSetting('notification-distance').then(d => {
        if (+d && Notification.permission === 'granted') notify(+d);
    });
    return Labs.labs;
};

const changedPosition = (pos, type = '?') => {
    addMessage('changedPosition ' + type);
    ['latitude', 'longitude', 'heading', 'timestamp'].forEach(k => localStorage.setItem(config['current_' + k], pos.coords[k] || 0));
    du.setInnerHtml('location', new Location(pos.coords) + ' &nbsp; ' + Location.formatBearing(pos.coords.heading || 0));
    du.setInnerHtml('timestamp', Location.formatTimestamp(pos.timestamp));
    du.setInnerHtml('compass-style', `.compass{transform: rotate(-${pos.coords.heading || 0}deg);}`);
    if (Map.marker) Map.marker.setLatLng([pos.coords.latitude, pos.coords.longitude]);
    Map.center();
    const fetchPos = new Location(localStorage.getItem(config.fetched_latitude), localStorage.getItem(config.fetched_longitude));
    st.getSetting('block-size').then(bs => {
        (Math.abs(bs) * 250 < fetchPos.distance(new Location(pos.coords))) ? changedPositionLarge(pos.coords) : changedPositionSmall(pos.coords);
    });
};

const watchLocation = (() => {
    let w = 0, i = 0;
    return () => {
        if (!navigator.geolocation) { du.setInnerHtml('location', "Geolocation API not supported"); return; }
        if (w) { navigator.geolocation.clearWatch(w); w = 0; }
        if (i) { clearInterval(i); i = 0; }
        Promise.all([st.getSetting('update-interval'), st.getSetting('high-accuracy')]).then(([int, acc]) => {
            if (+int === 0) {
                w = navigator.geolocation.watchPosition(changedPosition, err => du.setInnerHtml('location', err.message), { enableHighAccuracy: acc });
                addMessage('watchPosition: ' + w);
            } else if (+int > 0) {
                i = setInterval(() => navigator.geolocation.getCurrentPosition(p => changedPosition(p, 'interval'), err => du.setInnerHtml('location', err.message), { enableHighAccuracy: acc }), +int * 1000);
                addMessage('setInterval: ' + i);
            } else {
                changedPosition({
                    coords: { latitude: 52.0880131, longitude: 5.1273913, heading: 314 },
                    timestamp: Math.floor(Date.now() / 86400000) * 86400000 - 2 * 3600000 + 16 * 3600000 + 18 * 60000 + 3 * 1000
                }, 'D');
            }
        });
    };
})();

const enableNotifications = () => {
    if ('Notification' in window && Notification.permission !== 'granted') Notification.requestPermission();
};

const showMessages = () => {
    const html = '<div style="display:grid;grid-template-columns:auto auto;gap:0.2rem;">' +
                 MESSAGES.map(m => `<div>${Location.formatTimestamp(m.timestamp)}</div><div>${m.text}</div>`).join('') +
                 '</div>';
    du.setInnerHtml('page', html);
    du.setChecked('symbol-page');
};

/* ---------------------------------------------------- */
/*  GRÜN + JOURNAL – unabhängig von hide-logged        */
/* ---------------------------------------------------- */
const logLab = id => {
    const elem = document.getElementById('id' + id).getElementsByClassName('lab')[0];
    elem.parentNode.classList.add('wait');
    Labs.logLab(id, elem.querySelector('.answer select')?.value || elem.querySelector('.answer input')?.value)
        .then(res => {
            let color;
            switch (res.Result) {
                case 0:
                case 3:
                    color = 'yellow';
                    /* Journal-Popup mit Server-Antwort */
                    const html = (res.JournalImageUrl ? `<img src="${res.JournalImageUrl}" />` : '') +
                                 (res.JournalVideoYouTubeId ? `<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${res.JournalVideoYouTubeId}"></iframe></div>` : '') +
                                 (res.JournalMessage ? res.JournalMessage.replace(/\n/g, '<br />') : '');
                    du.setInnerHtml('popup-content', `<div class="journal">${html}</div>`);
                    du.setChecked('symbol-popup');
                    const journal = document.getElementById('journal-' + elem.parentNode.id.slice(2));
                    if (journal) { journal.innerHTML = html; journal.classList.remove('hidden'); }
                    if (res.hasOwnProperty('rating')) rateAdventure(res);
                    break;
                case 2:
                    color = 'orange';
                    break;
                default:
                    color = 'red';
            }
            elem.parentNode.classList.remove('wait');
            /* IMMER einfärben – egal ob hide-logged */
            Labs.labs.filter(lab => lab.id === id).forEach(lab => {
                lab.color = color;
                Map.setCircleColor(lab.id, color);
            });
            Labs.setBorderColor(elem, color);
            Labs.updateLocalStorage(id, { color: color });
        }).catch(console.error);
};

const postReview = () => {
    Promise.all([du.getElementValue('adventure_id'), du.getRadioValue('rating'), du.getElementValue('review')])
          .then(([aid, rat, rev]) => {
              document.getElementById('post-review').disabled = true;
              Labs.getData({ id: aid, block_size: rat, code: rev, special: 'ratings' })
                  .then(res => {
                      document.getElementById('post-review').disabled = false;
                      du.dispatchEvent(du.elemOrId('cancel'), 'click');
                  });
          });
};

const showJsonNavigation = () => {
    const tbl = document.getElementsByClassName('table-from-array')[0];
    const page = tbl ? +tbl.dataset.pgc_num || 0 : 0;
    const pages = tbl ? +tbl.dataset.pgt_num || 0 : 0;
    return (HREF_PREV ? `<a href="${HREF_PREV}"><b>⏎</b></a>` : '') +
           (pages > 1 && page > 0 ? ' &nbsp; ' + [...Array(pages).keys()].map((_, i) => i + 1 === page ? i + 1 : `<a href="${HREF_CURR}?page=${i + 1}">${i + 1}</a>`).join(' ') : '');
};

const showHref = href => {
    const [page, ext] = HREF_CURR.slice(1).split('.');
    const data = Object.fromEntries(new URLSearchParams(href.split('?').slice(1).join('?')));
    const key = ext === 'json' ? 'special' : 'html';
    data[key] = page;
    Labs.getData(data)
        .then(res => {
            du.setInnerHtml('page',
                '<input id="page-checkbox" class="hidden" type="checkbox" />' +
                `<h2 data-i18n-key="${('data-' + page).toLowerCase().replace(/(\s|_|-)+
