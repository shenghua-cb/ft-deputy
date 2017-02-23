'use strict';

const RSVP = require('rsvp');
const Joi = require('joi');
const jwt = require('jwt-simple');
const request = require('request');
const rp = require('request-promise');

const ENV = process.env.NODE_ENV || 'development';
const CLINET_ID = process.env.CBOAUTH2_CLIENT_ID;
const SECRET = process.env.CBOAUTH2_SECRET;
const DEV_KEY = process.env.DEV_KEY;

const configSchema = Joi.object().keys({
  clientId: Joi.string().required(),
  secret: Joi.string().required()
});

/*
  env
  region:
    - com
    - eu
*/
let getUrl = (region, env) => {
  let url = env === 'production' ? 'api' : 'wwwtest.api';
  region = region === 'eu' ? 'eu' : 'com';
  return `https://${url}.careerbuilder.${region}`;
};

let getTokenUrl = (region, env) => {
  return `${getUrl(region, env)}/oauth/token`;
};

let getClaims = (clientId) => {
  return {
    iss: clientId,
    sub: clientId,
    aud: 'https://api.careerbuilder.com/oauth/token',
    exp: parseInt((Date.now() + 30 * 60 * 1000) / 1000)
  }
};

let getJWT = (payload, secret) => {
  return jwt.encode(payload, secret, 'HS512');
};

let getToken = () => {
  return new RSVP.Promise((resolve, reject) => {
    Joi.assert({clientId: CLINET_ID, secret: SECRET}, configSchema);
    let url = getTokenUrl('com', ENV);
    let claims = getClaims(CLINET_ID);
    let formData = {
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: getJWT(claims, SECRET),
      grant_type: 'client_credentials',
      client_id: CLINET_ID,
      client_secret: SECRET // (optinal)
    };

    rp({
      method: 'POST',
      uri: url,
      form: formData,
      json: true
    }).then(body => {
      if (body.access_token) {
        resolve(body.access_token);
      } else {
        // such as { error: 'invalid_grant', error_description: 'Invalid grant type provided.' }
        reject(new FTError(body.error_description));
      }
    }).catch(err => reject(err));
  });
};

let sendRequest = (options) => {
  return new RSVP.Promise((resolve, reject) => {
    request(options, (err, httpResponse, body) => {
      if (err) {
        reject(err);
      } else {
        if (httpResponse.statusCode >= 200 && httpResponse.statusCode <= 299) {
          resolve(body);
        } else {
          /*
            error example:
            httpResponse.statusCode = 302
            body:
            <html><head><title>Object moved</title></head><body>
              <h2>Object moved to <a href="/Error.aspx?aspxerrorpath=/talentnetwork/internal/tankconfig/TN7L0KS75V8CSV87PX9C">here</a>.</h2>
            </body></html>
          */

          let message = '';
          try {
            message = JSON.parse(body);
            message = (message['errors'] || message['Errors'])[0].message;
          } catch (ex) {
            message = body;
          }

          if (httpResponse.statusCode === 400) {
            // had been catched by shenghua's api, we can return the error message to client.
            try {
              message = JSON.parse(body).ErrorMessage
            } catch (ex) {}
            err = new FTError(message);
          } else {
            message = `Error occurs when call matrix api, ${message}. Sorry for that, you can report it to fulfillment tools team.`;
            err = new Error(message);
          }

          err.code = httpResponse.statusCode;
          reject(err);
        }
      }
    });
  });
};

let queryTankConfig = (token, tnDid) => {
  let url = `${getUrl('com', ENV)}/consumer/talentnetwork/tankconfig/${tnDid}`;
  let options = {
    method: 'GET',
    uri: url,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };

  return sendRequest(options);
};

let updateTankConfig = (token, tnDid, data) => {
  let url = `${getUrl('com', ENV)}/consumer/talentnetwork/tankconfig/${tnDid}`;
  let options = {
    method: 'PUT',
    uri: url,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: data
  };

  return sendRequest(options);
};

let createTankConfig = (token, data) => {
  let url = `${getUrl('com', ENV)}/consumer/talentnetwork`;
  let options = {
    method: 'POST',
    uri: url,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  };

  return sendRequest(options);
};

// AccountDID, TNDID, TN Name, or Site URL
let queryTns = (searchObj) => {
  return new RSVP.Promise((resolve, reject) => {
    let url = `${getUrl('com', ENV)}/talentnetworks/${searchObj.kw}/json`;
    searchObj.qs.DeveloperKey = DEV_KEY;
    let options = {
      method: 'GET',
      uri: url,
      qs: searchObj.qs,
      json: true
    };
    request(options, (err, httpResponse, body) => {
      if (err) {
        reject(err);
      } else {
        if (httpResponse.statusCode >= 200 && httpResponse.statusCode <= 299) {
          resolve(body);
        } else {
          try {
            body = JSON.stringify(body);
          } catch (ex) {}

          err = new FTError(body);
          err.code = httpResponse.statusCode;
          reject(err);
        }
      }
    });
  });
};

module.exports = {
  query(tnDid) {
    return getToken().then(token => {
      return queryTankConfig(token, tnDid);
    });
  },

  update(tnDid, data) {
    return getToken().then(token => {
      return updateTankConfig(token, tnDid, data);
    });
  },

  create(data) {
    return getToken().then(token => {
      return createTankConfig(token, data);
    });
  },

  queryTns: queryTns
};