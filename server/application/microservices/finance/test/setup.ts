process.env.NODE_ENV = 'test';
process.env.TABLE_NAME = 'test-finance-table';
process.env.AWS_REGION = 'us-east-1';
process.env.EVENT_BUS_NAME = 'test-event-bus';
jest.setTimeout(10000);

