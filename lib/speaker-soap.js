'use strict';

const { XMLParser } = require('fast-xml-parser');
const parser = new XMLParser({
  removeNSPrefix: true, processEntities: false, parseTagValue: false,
  ignoreAttributes: false, attributesGroupName: '$', textNodeName: '_'
});

function soapValues(value) {
  if (Array.isArray(value)) return value.map(soapValues);
  if (!value || typeof value !== 'object') return value;
  const keys = Object.keys(value);
  if (typeof value._ === 'string' && keys.every(key => key === '_' || key === '$')) return value._;
  if (keys.length === 1 && Object.hasOwn(value.$ ?? {}, '@_dt')) return '';
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, key === '$' ? child : soapValues(child)]));
}

function readSoapBody(xml) {
  return soapValues(parser.parse(xml)?.Envelope?.Body);
}

module.exports = readSoapBody;
