const influxConfig = {
    url: 'http://influxdb:8086',
    token: 'mysecrettoken',
    org: 'water_org',  // ✅ Use org NAME, not ID
    bucket: 'water_bucket'
};

module.exports = influxConfig;
