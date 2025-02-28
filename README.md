# 👷 URL Shortener

This is a Node.js URL shortener app that uses [Cloudflare Workers](https://www.cloudflare.com/workers/).

The app is powered by [Cloudflare Workers](https://www.cloudflare.com/workers/) and [Upstash](https://upstash.com/) Redis for storing data and Kafka for storing the click events along with [Materialize](https://materialize.com/) for real-time data analytics.

[Upstash](https://upstash.com/) offers Serverless, Low latency, and pay-as-you-go solutions for Kafka and Redis.

[Materialize](https://materialize.com) is a streaming database for real-time applications. Materialize accepts input data from a variety of streaming sources (like Kafka), data stores and databases (like S3 and Postgres), and files (like CSV and JSON), and lets you query them using SQL.

## App structure

The demo app has the following structure:

- A serverless Cloudflare Worker that lets you add short links and redirect them to other URLs.
- All data is stored in Upstash serverless Redis cluster as key-value pairs (short link -> long link).
- Every time you visit a short link, it triggers an event and stores it in Upstash Kafka.
- We then get the data from Upstash Kafka and analyze it in Materialize in real-time.

A demo of the app can be found here:

## Diagram

The following is a diagram of the app structure:

## Demo

Here is a quick demo of how the app works:

![mz-upstash-demo](https://user-images.githubusercontent.com/21223421/160150872-58fca546-5a86-4132-8bb4-a989dc87ba83.gif)

## Prerequisites

Before you get started, you need to make sure that you have the following

- A Redis cluster and a Kafka cluster in Upstash.
- A Kafka topic in Upstash called `visits-log`.
- The Cloudflare CLI tool called `wrangler` on your local machine as described [here](https://developers.cloudflare.com/workers/cli-wrangler/install-update/)
- A Materialize instance running on your local machine as described [here](https://materialize.com/docs/install/) or a [Materialize Cloud instance](https://cloud.materialize.com/deployments).

## Running this demo

Once you have all the prerequisites, you can proceed with the following steps:

- Clone the repository and run the following command:

```bash
git clone https://github.com/bobbyiliev/cf-url-shortener.git
```

- Access the directory:

```bash
cd cf-url-shortener
```

- Install the `npm` dependencies:

```bash
npm install
```

- Run the `wrangler` command to authenticate with Cloudflare:

```bash
wrangler login
```

- Then in the `wrangler.toml` file, update the `account_id` to match your Cloudflare account ID:

```toml
account_id = "YOUR_ACCOUNT_ID_HERE"
```

- Set the following secrets in Cloudflare using the `wrangler` tool:

```bash
wrangler secret put UPSTASH_REDIS_REST_URL
wrangler secret put UPSTASH_REDIS_REST_TOKEN
wrangler secret put UPSTASH_KAFKA_REST_URL
wrangler secret put UPSTASH_KAFKA_REST_USERNAME
wrangler secret put UPSTASH_KAFKA_REST_PASSWORD
```

> Make sure to use the **REST API URLs** and not the Broker details.

- Run the following command to deploy the CF Worker:

```bash
wrangler deploy
```

With the CF Worker deployed, you can visit the admin URL where you can add short links and redirect them to other URLs.

## Setup Materialize

Once you've deployed the CF Worker, you can set up Materialize to analyze the data in Upstash Kafka in real-time.

Start by creating a new Materialize instance in Materialize Cloud:

- https://materialize.com/docs/cloud/get-started-with-cloud/

Or alternatively, you can install Materialize locally:

- https://materialize.com/docs/install/

After you've created the instance, you can connect to it using the `psql` command as shown in the docs.

### Create a [Kafka Source](https://materialize.com/docs/sql/create-source/kafka/)

The `CREATE SOURCE` statements allow you to connect Materialize to an external Kafka data source and lets you interact with its data as if the data were in a SQL table.

To create a new Kafka source in Materialize run the following statement:

```sql
CREATE SOURCE click_stats
  FROM KAFKA BROKER 'UPSTASH_KAFKA_BROKER_URL' TOPIC 'visits-log'
  WITH (
      security_protocol = 'SASL_SSL',
      sasl_mechanisms = 'SCRAM-SHA-256',
      sasl_username = 'UPSTASH_KAFKA_BROKER_USERNAME',
      sasl_password = 'UPSTASH_KAFKA_BROKER_PASSWORD'
  )
FORMAT BYTES;
```

> Change the Kafka details to match your Upstash Kafka cluster Broker and credentials.

Next, we will create a [NON-materialized View](https://materialize.com/docs/sql/create-view), which you can think of as kind of a reusable template to be used in other materialized views:

```sql
CREATE VIEW click_stats_v AS
    SELECT
        *
    FROM (
        SELECT
            (data->>'shortCode')::string AS short_code,
            (data->>'longUrl')::string AS long_url,
            (data->>'country')::string AS country,
            (data->>'city')::string AS city,
            (data->>'ip')::string AS ip
        FROM (
            SELECT CAST(data AS jsonb) AS data
            FROM (
                SELECT convert_from(data, 'utf8') AS data
                FROM click_stats
            )
        )
    );
```

Finally, create a [**materialized view**](https://materialize.com/docs/sql/create-materialized-view) to analyze the data in the Kafka source:

```sql
CREATE MATERIALIZED VIEW click_stats_m AS
    SELECT
        *
    FROM click_stats_v;
```

Then you can query the materialized view just using standard SQL, but get the data in real-time, with sub-millisecond latency:

```sql
SELECT * FROM click_stats_m;
```

You can stack up materialized views together, so let's order by the number of clicks per short link:

```sql
CREATE MATERIALIZED VIEW order_by_clicks AS
    SELECT
        short_code,
        COUNT(*) AS clicks
    FROM click_stats_m
    GROUP BY short_code;
```

One of the great features of Materialize is `TAIL`.

`TAIL` streams updates from a source, table, or view as they occur.

So to stream the data from our materialized view using `TAIL`, we can use the following statement:

```sql
COPY ( TAIL ( SELECT * FROM order_by_clicks ) ) TO STDOUT;
```

For more information about `TAIL`, check out this blog post:

> [Subscribe to changes in a view with TAIL in Materialize](https://materialize.com/subscribe-to-changes-in-a-view-with-tail-in-materialize/)

## Display the results in Metabase

As Materialize is Postgres-wire compatible, you can use BI tools like Metabase to create business intelligence dashboards using the real-time data streams in your Materialize instance.

For more information about Metabase + Materialize, check out the official documentation:

> [Metabase + Materialize](https://materialize.com/docs/third-party/metabase/)

Example dashboard that shows the number of clicks per short link:

![Materialize Metabase Dashboard](https://user-images.githubusercontent.com/21223421/162766444-5b78f011-9f0a-4515-9998-d8836040ddd7.png)

## Conclusion

Using Materialize to analyze the data in your Upstash Kafka serverless instance is a great way to get real-time insights into your data.

As a next step, here are some other great resources to learn about Materialize and Upstash:

- [Materialize](https://materialize.com/)
- [Upstash](https://upstash.com/)
- [Upstash Kafka](https://upstash.com/kafka/)
- [Upstash Redis](https://upstash.com/redis/)
- [Materialize Docs](https://materialize.com/docs/)

<!-- ### Kafka sink:

As of the time being inline avro schemas are not supported by Materialize.

An issue to track Upstash CSR can be found here:
https://github.com/upstash/issues/issues/20

```sql
CREATE SINK stats_sink
    FROM click_stats_m
    INTO KAFKA BROKER 'UPSTASH_KAFKA_BROKER_URL' TOPIC 'stats-sink'
    WITH (
      security_protocol = 'SASL_SSL',
      sasl_mechanisms = 'SCRAM-SHA-256',
      sasl_username = 'UPSTASH_KAFKA_BROKER_USERNAME',
      sasl_password = 'UPSTASH_KAFKA_BROKER_PASSWORD'
    )
    FORMAT AVRO USING SCHEMA '{
        "type": "record",
        "name": "envelope",
        "fields": { "name": "data", "type": "bytes" }
    }';
``` --># redis-kafka-materialize

# redis-kafka-materialize
