import { Renderer } from 'src/Renderer';
import * as utils from 'src/utils';
import { registerBidder } from 'src/adapters/bidderFactory';
import { BANNER, NATIVE, VIDEO } from 'src/mediaTypes';
import find from 'core-js/library/fn/array/find';
import includes from 'core-js/library/fn/array/includes';
import { config } from 'src/config';

const BIDDER_CODE = 'districtmDMX';
const URL = '//ib.adnxs.com/ut/v3/prebid';
const DMXURI = 'https://dmx.districtm.io/b/v1';
const ANX_SEAT = '1908';
const VIDEO_TARGETING = ['id', 'mimes', 'minduration', 'maxduration', 'startdelay', 'skippable', 'playback_method', 'frameworks'];
const USER_PARAMS = ['age', 'external_uid', 'segments', 'gender', 'dnt', 'language'];
const APP_DEVICE_PARAMS = ['geo', 'device_id']; // appid is collected separately
const NATIVE_MAPPING = {
    body: 'description',
    cta: 'ctatext',
    image: {
        serverName: 'main_image',
        requiredParams: { required: true },
        minimumParams: { sizes: [{}] },
    },
    icon: {
        serverName: 'icon',
        requiredParams: { required: true },
        minimumParams: { sizes: [{}] },
    },
    sponsoredBy: 'sponsored_by',
};
const SOURCE = 'pbjs';

export const spec = {
    code: BIDDER_CODE,
    supportedMediaTypes: ['banner', 'video'],
    isBidRequestValid(bid) {
        return !!(bid.params.dmxid && bid.params.memberid);
    },
    test() {
        return window.location.href.indexOf('dmTest=true') !== -1 ? 1 : 0;
    },
    buildRequests(bidRequest, bidderRequest) {
        if (cleanMediaTypeVideo(bidRequest).length > 0) {
            return [
                returnADNXS(bidRequest, bidderRequest),
                returnDMX(cleanMediaTypeVideo(bidRequest), bidderRequest)
            ];
        } else {
            return [
                returnADNXS(bidRequest, bidderRequest)
            ]
        }
    },
    interpretResponse(serverResponse, bidRequest) {
        serverResponse = serverResponse && serverResponse.body ? serverResponse.body : null;
        const bids = [];
        if (serverResponse) {
            if (serverResponse.tags) {
                return responseADNXS(serverResponse, bidRequest);
            } else if (serverResponse.seatbid) {
                return responseDMX(serverResponse, bidRequest);
            } else {
                return bids;
            }
        } else {
            return bids;
        }
    },
    transformBidParams(params, isOpenRtb) {
        params = utils.convertTypes({
            'member': 'string',
            'invCode': 'string',
            'placementId': 'number',
            'keywords': utils.transformBidderParamKeywords
        }, params);

        if (isOpenRtb) {
            params.use_pmt_rule = (typeof params.usePaymentRule === 'boolean') ? params.usePaymentRule : false;
            if (params.usePaymentRule) {
                delete params.usePaymentRule;
            }
            Object.keys(params).forEach(paramKey => {
                let convertedKey = utils.convertCamelToUnderscore(paramKey);
                if (convertedKey !== paramKey) {
                    params[convertedKey] = params[paramKey];
                    delete params[paramKey];
                }
            });
        }

        return params;
    },
    getUserSyncs(optionsType) {
        if (optionsType.iframeEnabled) {
            return [
                {
                    type: 'iframe',
                    url: 'https://cdn.districtm.io/ids/index.html'
                },
                {
                    type: 'iframe',
                    url: '//acdn.adnxs.com/ib/static/usersync/v3/async_usersync.html'
                }
            ]
        }
    }

}

function cleanMediaTypeVideo(bids) {
    const nBids = bids.filter(bid => {
        if (typeof bid.mediaTypes === 'undefined') {
            return true;
        }
        if (typeof bid.mediaTypes.video === 'undefined') {
            return true;
        }
        return false;
    })
    return nBids
}

function newRenderer(adUnitCode, rtbBid, rendererOptions = {}) {
    const renderer = Renderer.install({
        id: rtbBid.renderer_id,
        url: rtbBid.renderer_url,
        config: rendererOptions,
        loaded: false,
    });

    try {
        renderer.setRender(outstreamRender);
    } catch (err) {
        utils.logWarn('Prebid Error calling setRender on renderer', err);
    }

    renderer.setEventHandlers({
        impression: () => utils.logMessage('AppNexus outstream video impression event'),
        loaded: () => utils.logMessage('AppNexus outstream video loaded event'),
        ended: () => {
            utils.logMessage('AppNexus outstream renderer video event');
            document.querySelector(`#${adUnitCode}`).style.display = 'none';
        }
    });
    return renderer;
}

/**
 * Unpack the Server's Bid into a Prebid-compatible one.
 * @param serverBid
 * @param rtbBid
 * @param bidderRequest
 * @return Bid
 */
function newBid(serverBid, rtbBid, bidderRequest) {
    const bid = {
        requestId: serverBid.uuid,
        cpm: rtbBid.cpm,
        creativeId: rtbBid.creative_id,
        dealId: rtbBid.deal_id,
        currency: 'USD',
        netRevenue: true,
        ttl: 300,
        appnexus: {
            buyerMemberId: rtbBid.buyer_member_id
        }
    };

    if (rtbBid.rtb.video) {
        Object.assign(bid, {
            width: rtbBid.rtb.video.player_width,
            height: rtbBid.rtb.video.player_height,
            vastUrl: rtbBid.rtb.video.asset_url,
            vastImpUrl: rtbBid.notify_url,
            ttl: 3600
        });
        // This supports Outstream Video
        if (rtbBid.renderer_url) {
            const rendererOptions = utils.deepAccess(
                bidderRequest.bids[0],
                'renderer.options'
            );

            Object.assign(bid, {
                adResponse: serverBid,
                renderer: newRenderer(bid.adUnitCode, rtbBid, rendererOptions)
            });
            bid.adResponse.ad = bid.adResponse.ads[0];
            bid.adResponse.ad.video = bid.adResponse.ad.rtb.video;
        }
    } else if (rtbBid.rtb[NATIVE]) {
        const nativeAd = rtbBid.rtb[NATIVE];
        bid[NATIVE] = {
            title: nativeAd.title,
            body: nativeAd.desc,
            cta: nativeAd.ctatext,
            sponsoredBy: nativeAd.sponsored,
            clickUrl: nativeAd.link.url,
            clickTrackers: nativeAd.link.click_trackers,
            impressionTrackers: nativeAd.impression_trackers,
            javascriptTrackers: nativeAd.javascript_trackers,
        };
        if (nativeAd.main_img) {
            bid['native'].image = {
                url: nativeAd.main_img.url,
                height: nativeAd.main_img.height,
                width: nativeAd.main_img.width,
            };
        }
        if (nativeAd.icon) {
            bid['native'].icon = {
                url: nativeAd.icon.url,
                height: nativeAd.icon.height,
                width: nativeAd.icon.width,
            };
        }
    } else {
        Object.assign(bid, {
            width: rtbBid.rtb.banner.width,
            height: rtbBid.rtb.banner.height,
            ad: rtbBid.rtb.banner.content
        });
        try {
            const url = rtbBid.rtb.trackers[0].impression_urls[0];
            const tracker = utils.createTrackPixelHtml(url);
            bid.ad += tracker;
        } catch (error) {
            utils.logError('Error appending tracking pixel', error);
        }
    }

    return bid;
}

function bidToTag(bid) {
    const tag = {};
    tag.sizes = transformSizes(bid.sizes);
    tag.primary_size = tag.sizes[0];
    tag.ad_types = [];
    tag.uuid = bid.bidId;
    bid.params.member = ANX_SEAT;
    bid.params.invCode = `dm-pl-${bid.params.dmxid}`;
    if (bid.params.placementId) {
        tag.id = parseInt(bid.params.placementId, 10);
    } else {
        tag.code = bid.params.invCode;
    }
    tag.allow_smaller_sizes = bid.params.allowSmallerSizes || false;
    tag.use_pmt_rule = bid.params.usePaymentRule || false
    tag.prebid = true;
    tag.disable_psa = true;
    if (bid.params.reserve) {
        tag.reserve = bid.params.reserve;
    }
    if (bid.params.position) {
        tag.position = {'above': 1, 'below': 2}[bid.params.position] || 0;
    }
    if (bid.params.trafficSourceCode) {
        tag.traffic_source_code = bid.params.trafficSourceCode;
    }
    if (bid.params.privateSizes) {
        tag.private_sizes = transformSizes(bid.params.privateSizes);
    }
    if (bid.params.supplyType) {
        tag.supply_type = bid.params.supplyType;
    }
    if (bid.params.pubClick) {
        tag.pubclick = bid.params.pubClick;
    }
    if (bid.params.extInvCode) {
        tag.ext_inv_code = bid.params.extInvCode;
    }
    if (bid.params.externalImpId) {
        tag.external_imp_id = bid.params.externalImpId;
    }
    if (!utils.isEmpty(bid.params.keywords)) {
        tag.keywords = utils.transformBidderParamKeywords(bid.params.keywords);
    }

    if (bid.mediaType === NATIVE || utils.deepAccess(bid, `mediaTypes.${NATIVE}`)) {
        tag.ad_types.push(NATIVE);

        if (bid.nativeParams) {
            const nativeRequest = buildNativeRequest(bid.nativeParams);
            tag[NATIVE] = {layouts: [nativeRequest]};
        }
    }

    const videoMediaType = utils.deepAccess(bid, `mediaTypes.${VIDEO}`);
    const context = utils.deepAccess(bid, 'mediaTypes.video.context');

    if (bid.mediaType === VIDEO || videoMediaType) {
        tag.ad_types.push(VIDEO);
    }

    // instream gets vastUrl, outstream gets vastXml
    if (bid.mediaType === VIDEO || (videoMediaType && context !== 'outstream')) {
        tag.require_asset_url = true;
    }

    if (bid.params.video) {
        tag.video = {};
        // place any valid video params on the tag
        Object.keys(bid.params.video)
            .filter(param => includes(VIDEO_TARGETING, param))
            .forEach(param => tag.video[param] = bid.params.video[param]);
    }

    if (
        (utils.isEmpty(bid.mediaType) && utils.isEmpty(bid.mediaTypes)) ||
        (bid.mediaType === BANNER || (bid.mediaTypes && bid.mediaTypes[BANNER]))
    ) {
        tag.ad_types.push(BANNER);
    }

    return tag;
}

/* Turn bid request sizes into ut-compatible format */
function transformSizes(requestSizes) {
    let sizes = [];
    let sizeObj = {};

    if (utils.isArray(requestSizes) && requestSizes.length === 2 &&
        !utils.isArray(requestSizes[0])) {
        sizeObj.width = parseInt(requestSizes[0], 10);
        sizeObj.height = parseInt(requestSizes[1], 10);
        sizes.push(sizeObj);
    } else if (typeof requestSizes === 'object') {
        for (let i = 0; i < requestSizes.length; i++) {
            let size = requestSizes[i];
            sizeObj = {};
            sizeObj.width = parseInt(size[0], 10);
            sizeObj.height = parseInt(size[1], 10);
            sizes.push(sizeObj);
        }
    }

    return sizes;
}

function hasUserInfo(bid) {
    return !!bid.params.user;
}

function hasMemberId(bid) {
    return !!parseInt(bid.params.member, 10);
}

function hasAppDeviceInfo(bid) {
    if (bid.params) {
        return !!bid.params.app
    }
}

function hasAppId(bid) {
    if (bid.params && bid.params.app) {
        return !!bid.params.app.id
    }
    return !!bid.params.app
}

function getRtbBid(tag) {
    return tag && tag.ads && tag.ads.length && find(tag.ads, ad => ad.rtb);
}

function buildNativeRequest(params) {
    const request = {};

    // map standard prebid native asset identifier to /ut parameters
    // e.g., tag specifies `body` but /ut only knows `description`.
    // mapping may be in form {tag: '<server name>'} or
    // {tag: {serverName: '<server name>', requiredParams: {...}}}
    Object.keys(params).forEach(key => {
        // check if one of the <server name> forms is used, otherwise
        // a mapping wasn't specified so pass the key straight through
        const requestKey =
            (NATIVE_MAPPING[key] && NATIVE_MAPPING[key].serverName) ||
            NATIVE_MAPPING[key] ||
            key;

        // required params are always passed on request
        const requiredParams = NATIVE_MAPPING[key] && NATIVE_MAPPING[key].requiredParams;
        request[requestKey] = Object.assign({}, requiredParams, params[key]);

        // minimum params are passed if no non-required params given on adunit
        const minimumParams = NATIVE_MAPPING[key] && NATIVE_MAPPING[key].minimumParams;

        if (requiredParams && minimumParams) {
            // subtract required keys from adunit keys
            const adunitKeys = Object.keys(params[key]);
            const requiredKeys = Object.keys(requiredParams);
            const remaining = adunitKeys.filter(key => !includes(requiredKeys, key));

            // if none are left over, the minimum params needs to be sent
            if (remaining.length === 0) {
                request[requestKey] = Object.assign({}, request[requestKey], minimumParams);
            }
        }
    });

    return request;
}

function outstreamRender(bid) {
    // push to render queue because ANOutstreamVideo may not be loaded yet
    bid.renderer.push(() => {
        window.ANOutstreamVideo.renderAd({
            tagId: bid.adResponse.tag_id,
            sizes: [bid.getSize().split('x')],
            targetId: bid.adUnitCode, // target div id to render video
            uuid: bid.adResponse.uuid,
            adResponse: bid.adResponse,
            rendererOptions: bid.renderer.getConfig()
        }, handleOutstreamRendererEvents.bind(null, bid));
    });
}

function handleOutstreamRendererEvents(bid, id, eventName) {
    bid.renderer.handleVideoEvent({ id, eventName });
}

function parseMediaType(rtbBid) {
    const adType = rtbBid.ad_type;
    if (adType === VIDEO) {
        return VIDEO;
    } else if (adType === NATIVE) {
        return NATIVE;
    } else {
        return BANNER;
    }
}

function returnDMX(bidRequest, bidderRequest) {
    let timeout = config.getConfig('bidderTimeout');
    let dmxRequest = {
        id: utils.generateUUID(),
        cur: ['USD'],
        tmax: (timeout - 300),
        test: spec.test() || 0,
        site: {
            publisher: { id: String(bidRequest[0].params.memberid) || null }
        }
    }
    if (!dmxRequest.test) {
        delete dmxRequest.test;
    }
    if (bidderRequest.gdprConsent) {
        dmxRequest.regs = {};
        dmxRequest.regs.ext = {};
        dmxRequest.regs.ext.gdpr = bidderRequest.gdprConsent.gdprApplies === true ? 1 : 0;
        dmxRequest.user = {};
        dmxRequest.user.ext = {};
        dmxRequest.user.ext.consent = bidderRequest.gdprConsent.consentString;
    }
    let tosendtags = bidRequest.map(dmx => {
        var obj = {};
        obj.id = dmx.bidId;
        obj.tagid = String(dmx.params.dmxid);
        obj.secure = window.location.protocol === 'https:' ? 1 : 0;
        obj.banner = {
            topframe: 1,
            w: dmx.sizes[0][0] || 0,
            h: dmx.sizes[0][1] || 0,
            format: dmx.sizes.map(s => {
                return {w: s[0], h: s[1]};
            }).filter(obj => typeof obj.w === 'number' && typeof obj.h === 'number')
        };
        return obj;
    });
    dmxRequest.imp = tosendtags;
    return {
        method: 'POST',
        url: DMXURI,
        data: JSON.stringify(dmxRequest),
        options: {
            contentType: 'application/json',
            withCredentials: true
        },
        bidderRequest
    }
}

function returnADNXS(bidRequests, bidderRequest) {
    const tags = bidRequests.map(bidToTag);
    const userObjBid = find(bidRequests, hasUserInfo);
    let userObj;
    if (userObjBid) {
        userObj = {};
        Object.keys(userObjBid.params.user)
            .filter(param => includes(USER_PARAMS, param))
            .forEach(param => userObj[param] = userObjBid.params.user[param]);
    }

    const appDeviceObjBid = find(bidRequests, hasAppDeviceInfo);
    let appDeviceObj;
    if (appDeviceObjBid && appDeviceObjBid.params && appDeviceObjBid.params.app) {
        appDeviceObj = {};
        Object.keys(appDeviceObjBid.params.app)
            .filter(param => includes(APP_DEVICE_PARAMS, param))
            .forEach(param => appDeviceObj[param] = appDeviceObjBid.params.app[param]);
    }

    const appIdObjBid = find(bidRequests, hasAppId);
    let appIdObj;
    if (appIdObjBid && appIdObjBid.params && appDeviceObjBid.params.app && appDeviceObjBid.params.app.id) {
        appIdObj = {
            appid: appIdObjBid.params.app.id
        };
    }

    const memberIdBid = find(bidRequests, hasMemberId);
    const member = memberIdBid ? parseInt(memberIdBid.params.member, 10) : 0;

    const payload = {
        tags: [...tags],
        user: userObj,
        sdk: {
            source: SOURCE,
            version: '$prebid.version$'
        }
    };
    if (member > 0) {
        payload.member_id = member;
    }

    if (appDeviceObjBid) {
        payload.device = appDeviceObj
    }
    if (appIdObjBid) {
        payload.app = appIdObj;
    }

    if (bidderRequest && bidderRequest.gdprConsent) {
        // note - objects for impbus use underscore instead of camelCase
        payload.gdpr_consent = {
            consent_string: bidderRequest.gdprConsent.consentString,
            consent_required: bidderRequest.gdprConsent.gdprApplies
        };
    }

    if (bidderRequest && bidderRequest.refererInfo) {
        let refererinfo = {
            rd_ref: encodeURIComponent(bidderRequest.refererInfo.referer),
            rd_top: bidderRequest.refererInfo.reachedTop,
            rd_ifs: bidderRequest.refererInfo.numIframes,
            rd_stk: bidderRequest.refererInfo.stack.map((url) => encodeURIComponent(url)).join(',')
        }
        payload.referrer_detection = refererinfo;
    }

    const payloadString = JSON.stringify(payload);
    return {
        method: 'POST',
        url: URL,
        data: payloadString,
        bidderRequest
    };
}

function responseADNXS(serverResponse, {bidderRequest}) {
    const bids = [];
    serverResponse.tags.forEach(serverBid => {
        const rtbBid = getRtbBid(serverBid);
        if (rtbBid) {
            if (rtbBid.cpm !== 0 && includes(spec.supportedMediaTypes, rtbBid.ad_type)) {
                const bid = newBid(serverBid, rtbBid, bidderRequest);
                bid.cpm = bid.cpm * 0.9;
                bid.mediaType = parseMediaType(rtbBid);
                bids.push(bid);
            }
        }
    });
    return bids;
}

function responseDMX(serverResponse, bidRequest) {
    if (utils.isArray(serverResponse.seatbid)) {
        const {seatbid} = serverResponse;
        let winners = seatbid.reduce((bid, ads) => {
            let ad = ads.bid.reduce(function(oBid, nBid) {
                if (oBid.price < nBid.price) {
                    const bid = matchRequest(nBid.impid, bidRequest);
                    const {width, height} = defaultSize(bid);
                    nBid.cpm = nBid.price;
                    nBid.bidId = nBid.impid;
                    nBid.requestId = nBid.impid;
                    nBid.width = nBid.w || width;
                    nBid.height = nBid.h || height;
                    nBid.ad = nBid.adm;
                    nBid.netRevenue = true;
                    nBid.creativeId = nBid.crid;
                    nBid.currency = 'USD';
                    nBid.ttl = 60;

                    return nBid;
                } else {
                    oBid.cpm = oBid.price;
                    return oBid;
                }
            }, {price: 0});
            if (ad.adm) {
                bid.push(ad)
            }
            return bid;
        }, [])
        let winnersClean = winners.filter(w => {
            if (w.bidId) {
                return true;
            }
            return false;
        });
        return winnersClean;
    }
}

export function matchRequest(id, bidRequest) {
    const {bids} = bidRequest.bidderRequest;
    const [returnValue] = bids.filter(bid => bid.bidId === id);
    return returnValue;
}
export function checkDeepArray(Arr) {
    if (Array.isArray(Arr)) {
        if (Array.isArray(Arr[0])) {
            return Arr[0];
        } else {
            return Arr;
        }
    } else {
        return Arr;
    }
}
export function defaultSize(thebidObj) {
    const {sizes} = thebidObj;
    const returnObject = {};
    returnObject.width = checkDeepArray(sizes)[0];
    returnObject.height = checkDeepArray(sizes)[1];
    return returnObject;
}

registerBidder(spec);